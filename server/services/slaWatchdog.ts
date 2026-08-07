import { db } from '../db/client';
import { conversations, conversationSlaEvents, leads } from '../db/schema';
import { and, eq, isNull, isNotNull } from 'drizzle-orm';
import { emitNotification } from './notifications';
import { notifyVendoresWhatsapp } from './whatsappNotify';

/**
 * Worker que monitora o tempo de espera dos leads na fila Comercial.
 *
 * Escalonamento em 3 niveis (minutos sem ninguem atribuir):
 *   1 -> 5 min  : repete ping no WhatsApp pros vendedores (lembrete)
 *   2 -> 10 min : escala pro admin (notif in-app)
 *   3 -> 30 min : alerta critico admin (in-app + WhatsApp admins)
 *
 * Idempotencia: tabela conversation_sla_events tem unique index
 * (conversation_id, level), entao mesmo se varios ticks rodarem o mesmo nivel
 * so dispara uma vez. Worker insere ANTES de notificar — se insercao falhar
 * por conflito, ignora (ja foi notificado).
 *
 * Single-instance assumption: Lubritec roda num so processo. Em deploy
 * multi-instance, seria necessario advisory lock no Postgres.
 */

const TICK_MS = 60_000;
const LEVEL_1_MIN = 5;
const LEVEL_2_MIN = 10;
const LEVEL_3_MIN = 30;

let timer: NodeJS.Timeout | null = null;
let isProcessing = false;

export function startSlaWatchdog(): void {
  if (timer) return;
  timer = setInterval(tick, TICK_MS);
  // Tick inicial pouco depois do boot.
  setTimeout(tick, 15_000);
}

export function stopSlaWatchdog(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

async function tick(): Promise<void> {
  if (isProcessing) return;
  isProcessing = true;
  try {
    const r = await processEscalations();
    if (r.fired > 0) {
      console.log(`[sla-watchdog] tick: fired=${r.fired} (l1=${r.l1} l2=${r.l2} l3=${r.l3})`);
    }

    // Vigilancia independente: conversa JA assumida sem resposta nossa. Try
    // separado de proposito — uma falha aqui nao pode derrubar o escalonamento
    // de fila, e vice-versa.
    try {
      // Import dinamico de proposito: com import estatico, uma falha ao carregar
      // este modulo derrubaria o slaWatchdog inteiro junto.
      const { processPendingReplies } = await import('./pendingReplyWatch');
      const p = await processPendingReplies();
      if (p.l1 + p.l2 > 0) {
        console.log(`[pending-reply] tick: l1=${p.l1} l2=${p.l2}`);
      }
    } catch (err) {
      console.error('[pending-reply] tick failed:', err instanceof Error ? err.message : err);
    }
  } catch (err) {
    console.error('[sla-watchdog] tick failed:', err instanceof Error ? err.message : err);
  } finally {
    isProcessing = false;
  }
}

interface EscalationCounts {
  fired: number;
  l1: number;
  l2: number;
  l3: number;
}

export async function processEscalations(): Promise<EscalationCounts> {
  // Leads esperando na fila Comercial sem dono, com enteredQueueAt setado.
  const candidates = await db
    .select({
      id: conversations.id,
      leadId: conversations.leadId,
      phone: conversations.phone,
      enteredQueueAt: conversations.enteredQueueAt,
      handoffSummary: conversations.handoffSummary,
      leadName: leads.name,
    })
    .from(conversations)
    .leftJoin(leads, eq(conversations.leadId, leads.id))
    .where(
      and(
        eq(conversations.queue, 'comercial'),
        eq(conversations.status, 'aguardando_atendimento'),
        isNull(conversations.assignedTo),
        isNotNull(conversations.enteredQueueAt),
      ),
    );

  let l1 = 0, l2 = 0, l3 = 0;
  const now = Date.now();
  for (const c of candidates) {
    if (!c.enteredQueueAt) continue;
    const waitMin = (now - new Date(c.enteredQueueAt).getTime()) / 60_000;

    // Quais niveis ja dispararam pra essa conversa?
    const fired = await db
      .select({ level: conversationSlaEvents.level })
      .from(conversationSlaEvents)
      .where(eq(conversationSlaEvents.conversationId, c.id));
    const firedLevels = new Set(fired.map((f) => f.level));

    const meta = {
      leadName: c.leadName ?? c.phone,
      leadPhone: c.phone,
      summary: c.handoffSummary,
      conversationId: c.id,
      leadId: c.leadId,
      waitMin: Math.floor(waitMin),
    };

    if (waitMin >= LEVEL_3_MIN && !firedLevels.has(3)) {
      const ok = await recordLevel(c.id, 3);
      if (ok) { await fireLevel3(meta); l3++; }
    }
    if (waitMin >= LEVEL_2_MIN && !firedLevels.has(2)) {
      const ok = await recordLevel(c.id, 2);
      if (ok) { await fireLevel2(meta); l2++; }
    }
    if (waitMin >= LEVEL_1_MIN && !firedLevels.has(1)) {
      const ok = await recordLevel(c.id, 1);
      if (ok) { await fireLevel1(meta); l1++; }
    }
  }

  return { fired: l1 + l2 + l3, l1, l2, l3 };
}

/**
 * Insere event de nivel. Retorna false se ja existia (concurrent race) — caller
 * pula a notificacao nesse caso.
 */
async function recordLevel(conversationId: string, level: number): Promise<boolean> {
  try {
    const inserted = await db
      .insert(conversationSlaEvents)
      .values({ conversationId, level })
      .onConflictDoNothing({ target: [conversationSlaEvents.conversationId, conversationSlaEvents.level] })
      .returning({ id: conversationSlaEvents.id });
    return inserted.length > 0;
  } catch (err) {
    console.warn(`[sla-watchdog] failed to record level ${level} for conv ${conversationId}:`, err);
    return false;
  }
}

interface FireMeta {
  leadName: string;
  leadPhone: string;
  summary: string | null;
  conversationId: string;
  leadId: string;
  waitMin: number;
}

function inboxUrlFor(leadId: string): string {
  return `/whatsapp?queue=comercial&statusChips=aguardando,em_atendimento&assignment=all&origin=organic,campaign&lead=${leadId}`;
}

async function fireLevel1(m: FireMeta): Promise<void> {
  // Repete ping WhatsApp pros vendedores — fire and forget.
  notifyVendoresWhatsapp({
    leadName: m.leadName,
    leadPhone: m.leadPhone,
    summary: m.summary ? `⏰ Aguardando há ${m.waitMin} min\n\n${m.summary}` : `⏰ Aguardando há ${m.waitMin} min`,
    inboxRelativeUrl: inboxUrlFor(m.leadId),
  }).catch((err) => {
    console.warn('[sla-watchdog] level1 WhatsApp ping failed:', err instanceof Error ? err.message : err);
  });
  await emitNotification({
    toRoles: ['comercial', 'admin'],
    kind: 'sla_escalation',
    title: `Lead esperando há ${m.waitMin} min`,
    body: `${m.leadName} está na fila Comercial sem atendente.`,
    actionUrl: inboxUrlFor(m.leadId),
    metadata: { conversationId: m.conversationId, level: 1, waitMin: m.waitMin },
  });
}

async function fireLevel2(m: FireMeta): Promise<void> {
  await emitNotification({
    toRoles: ['admin'],
    kind: 'sla_escalation',
    title: `⚠️ Lead esperando há ${m.waitMin} min — escalado`,
    body: `${m.leadName} está há mais de 10 min na fila Comercial sem ninguém assumir.`,
    actionUrl: inboxUrlFor(m.leadId),
    metadata: { conversationId: m.conversationId, level: 2, waitMin: m.waitMin },
  });
  notifyVendoresWhatsapp({
    leadName: m.leadName,
    leadPhone: m.leadPhone,
    summary: `⚠️ ESCALADO: aguardando há ${m.waitMin} min sem atendente`,
    inboxRelativeUrl: inboxUrlFor(m.leadId),
  }).catch(() => { /* best-effort */ });
}

async function fireLevel3(m: FireMeta): Promise<void> {
  await emitNotification({
    toRoles: ['admin'],
    kind: 'sla_escalation',
    title: `🚨 CRÍTICO: lead há ${m.waitMin} min sem atendente`,
    body: `${m.leadName} está há mais de 30 min na fila Comercial. Intervenção manual necessária.`,
    actionUrl: inboxUrlFor(m.leadId),
    metadata: { conversationId: m.conversationId, level: 3, waitMin: m.waitMin },
  });
  notifyVendoresWhatsapp({
    leadName: m.leadName,
    leadPhone: m.leadPhone,
    summary: `🚨 CRÍTICO: ${m.waitMin} min sem atendente. Lubritec — atender já.`,
    inboxRelativeUrl: inboxUrlFor(m.leadId),
  }).catch(() => { /* best-effort */ });
}
