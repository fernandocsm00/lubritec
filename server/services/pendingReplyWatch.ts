import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { conversationReplyAlerts, conversations, leads } from '../db/schema';
import { awaitingUsSql } from '../lib/pendingReply';
import { businessConfigFromSettings, businessMinutesBetween } from '../lib/businessHours';
import { loadOrgSettingsRow } from './orgSettingsService';
import { emitNotification } from './notifications';

/**
 * Vigia conversa em que o cliente esta esperando resposta NOSSA.
 *
 * Diferente do processEscalations do slaWatchdog, que so olha lead que ninguem
 * ASSUMIU: aqui a conversa ja tem dono e ja esta em atendimento — era o buraco
 * por onde passavam quase todas as pendencias reais.
 *
 * Idempotencia por CICLO: a chave e (conversa, last_inbound_at, nivel). Estar
 * devendo resposta e recorrente, entao amarrar o alerta so a (conversa, nivel)
 * faria cada conversa avisar uma unica vez na vida.
 */
export async function processPendingReplies(): Promise<{ l1: number; l2: number }> {
  // loadOrgSettingsRow (nao getOrgSettings/PublicOrgSettings) porque
  // pendingReplyAlertMin/pendingReplyEscalateMin ainda nao estao mapeados no
  // toPublic() do orgSettingsService — a row crua do drizzle ja tem as colunas.
  const settings = await loadOrgSettingsRow();
  if (!settings) {
    console.warn('[pending-reply] org settings singleton nao encontrado, pulando tick');
    return { l1: 0, l2: 0 };
  }
  const cfg = businessConfigFromSettings(settings);
  const alertMin = settings.pendingReplyAlertMin;
  const escalateMin = settings.pendingReplyEscalateMin;
  const agora = new Date();

  const candidatas = await db
    .select({
      id: conversations.id,
      leadId: conversations.leadId,
      phone: conversations.phone,
      assignedTo: conversations.assignedTo,
      lastInboundAt: conversations.lastInboundAt,
      leadName: leads.name,
    })
    .from(conversations)
    .leftJoin(leads, eq(conversations.leadId, leads.id))
    .where(awaitingUsSql());

  let l1 = 0;
  let l2 = 0;

  for (const c of candidatas) {
    if (!c.lastInboundAt) continue;
    const esperaMin = businessMinutesBetween(c.lastInboundAt, agora, cfg);

    const jaDisparados = await db
      .select({ level: conversationReplyAlerts.level })
      .from(conversationReplyAlerts)
      .where(and(
        eq(conversationReplyAlerts.conversationId, c.id),
        eq(conversationReplyAlerts.pendingSince, c.lastInboundAt),
      ));
    const niveis = new Set(jaDisparados.map((r) => r.level));

    const meta = {
      nome: c.leadName ?? c.phone,
      conversationId: c.id,
      leadId: c.leadId,
      esperaMin,
    };

    // Grava ANTES de notificar, de proposito: se o processo morrer entre as duas
    // coisas, perde-se um alerta daquele ciclo. A ordem inversa trocaria isso por
    // re-notificar a cada tick enquanto a gravacao falhasse — barulho pior que
    // silencio. Ver a decisao no spec.
    if (esperaMin >= escalateMin && !niveis.has(2)) {
      if (await registrar(c.id, c.lastInboundAt, 2)) {
        await notificar(2, meta);
        l2 += 1;
      }
    }
    if (esperaMin >= alertMin && !niveis.has(1)) {
      if (await registrar(c.id, c.lastInboundAt, 1)) {
        await notificar(1, meta, c.assignedTo);
        l1 += 1;
      }
    }
  }

  return { l1, l2 };
}

/**
 * Grava o alerta do ciclo.
 *
 * Retorna false em dois casos bem diferentes:
 *   - insert sem linhas: outro tick ganhou a corrida. Esperado e benigno.
 *   - excecao: problema real (conexao, schema, conversa apagada no meio). Nunca
 *     e a corrida — onConflictDoNothing nao lanca nesse caso.
 */
async function registrar(
  conversationId: string, pendingSince: Date, level: 1 | 2,
): Promise<boolean> {
  try {
    const inserted = await db
      .insert(conversationReplyAlerts)
      .values({ conversationId, pendingSince, level })
      .onConflictDoNothing({
        target: [
          conversationReplyAlerts.conversationId,
          conversationReplyAlerts.pendingSince,
          conversationReplyAlerts.level,
        ],
      })
      .returning({ id: conversationReplyAlerts.id });
    return inserted.length > 0;
  } catch (err) {
    console.error(`[pending-reply] falhou ao registrar nivel ${level}:`, err);
    return false;
  }
}

interface Meta {
  nome: string;
  conversationId: string;
  leadId: string;
  esperaMin: number;
}

function inboxUrlFor(leadId: string): string {
  return `/whatsapp?queue=comercial&statusChips=aguardando,em_atendimento&assignment=all&origin=organic,campaign&lead=${leadId}`;
}

function formatarEspera(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

async function notificar(level: 1 | 2, m: Meta, assignedTo?: string | null): Promise<void> {
  const espera = formatarEspera(m.esperaMin);

  if (level === 1) {
    // Dono primeiro. Sem dono, a fila inteira — decisao do brainstorming: e
    // melhor todo mundo ver do que a pendencia ficar orfa.
    const destino = assignedTo
      ? { userIds: [assignedTo] }
      : { toRoles: ['comercial' as const] };
    await emitNotification({
      ...destino,
      kind: 'pending_reply',
      title: `Cliente esperando há ${espera}`,
      body: `${m.nome} mandou mensagem e ainda não teve resposta.`,
      actionUrl: inboxUrlFor(m.leadId),
      metadata: { conversationId: m.conversationId, level: 1, esperaMin: m.esperaMin },
    });
    return;
  }

  await emitNotification({
    toRoles: ['admin'],
    kind: 'pending_reply',
    title: `⚠️ ${m.nome} sem resposta há ${espera}`,
    body: 'Pendência de resposta passou do prazo de escalação.',
    actionUrl: inboxUrlFor(m.leadId),
    metadata: { conversationId: m.conversationId, level: 2, esperaMin: m.esperaMin },
  });
}
