import { db } from '../db/client';
import { conversations } from '../db/schema';
import { eq, and, lt, inArray } from 'drizzle-orm';
import { isAiBusinessHours } from '../lib/businessHours';
import { AI_QUEUES } from '../lib/aiQueues';
import { loadOrgSettingsRow } from './orgSettingsService';
import { aiBatchWaitMs, isAiReplyInFlight, replyToPendingInbound } from './aiInboundBatch';

/**
 * Worker que reprocessa conversas marcadas com pending_ai_response=true.
 *
 * Quando uma mensagem inbound chega fora do horario comercial, aiAtendimento
 * envia (opcionalmente) a mensagem fora-do-horario e marca pending=true sem
 * chamar Gemini. Este worker fica varrendo de 60 em 60 segundos: quando o
 * horario comercial volta, ele pega cada conversa pendente e responde o lote
 * do cliente (replyToPendingInbound) — IA processa normalmente e limpa o flag.
 * Tambem cobre a espera do lote perdida num restart do processo.
 *
 * Single-tenant + Lubritec roda single-instance (sem necessidade de lock
 * distribuido por ora). Flag isProcessing previne reentry da mesma instancia.
 */

const TICK_MS = 60_000;
const MAX_PER_TICK = 20;

let timer: NodeJS.Timeout | null = null;
let isProcessing = false;

export function startAiPendingWorker(): void {
  if (timer) return;
  timer = setInterval(tick, TICK_MS);
  // Tick inicial pouco depois do boot pra nao competir com migrations / outros workers.
  setTimeout(tick, 12_000);
}

export function stopAiPendingWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

async function tick(): Promise<void> {
  if (isProcessing) return;
  isProcessing = true;
  try {
    await processPending();
  } catch (err) {
    console.error('[ai-pending-worker] tick failed:', err instanceof Error ? err.message : err);
  } finally {
    isProcessing = false;
  }
}

export async function processPending(): Promise<{ processed: number; skipped: number }> {
  const settings = await loadOrgSettingsRow();
  if (!settings || !settings.aiEnabled) {
    return { processed: 0, skipped: 0 };
  }
  const hoursCheck = isAiBusinessHours(new Date(), settings);
  if (!hoursCheck.ok) {
    // Fora do horario — nada a fazer, mensagens ficam pending pro proximo tick.
    return { processed: 0, skipped: 0 };
  }

  // Pega só conversas cujo último inbound passou da espera do lote + 3min: além
  // do caso fora-do-horário, o flag é setado na INGESTÃO de todo inbound de texto
  // na fila IA (rede de segurança contra crash). A resposta normal sai depois da
  // espera do lote (aiInboundBatch) e ainda leva até ~2min (Gemini + delay
  // humanizado de até 60s) — sem essa folga o worker roubaria a conversa em voo
  // e o cliente receberia resposta dupla.
  const pickupThreshold = new Date(Date.now() - aiBatchWaitMs() - 3 * 60_000);
  const pending = await db
    .select({
      id: conversations.id,
      leadId: conversations.leadId,
      phone: conversations.phone,
      lastInboundAt: conversations.lastInboundAt,
    })
    .from(conversations)
    .where(and(
      eq(conversations.pendingAiResponse, true),
      // 'ia' + 'recepcao' (ver AI_QUEUES); 'comercial' fica de fora.
      inArray(conversations.queue, [...AI_QUEUES]),
      // Humano assumiu esta conversa — worker não pode reanimar a IA.
      eq(conversations.aiDisabled, false),
      lt(conversations.lastInboundAt, pickupThreshold),
    ))
    .limit(MAX_PER_TICK);

  let processed = 0;
  let skipped = 0;
  const staleThreshold = Date.now() - 24 * 60 * 60_000;
  for (const conv of pending) {
    // Inbound com mais de 24h (ex.: IA ficou desligada dias e foi religada):
    // responder agora seria mensagem zumbi — limpa o flag e deixa pro humano.
    if (conv.lastInboundAt && conv.lastInboundAt.getTime() < staleThreshold) {
      await db
        .update(conversations)
        .set({ pendingAiResponse: false, updatedAt: new Date() })
        .where(eq(conversations.id, conv.id));
      console.warn(`[ai-pending-worker] conv ${conv.id}: inbound >24h, flag limpo sem resposta da IA`);
      skipped++;
      continue;
    }
    // Resposta desta conversa já agendada/rodando neste processo: é dela.
    if (isAiReplyInFlight(conv.id)) {
      skipped++;
      continue;
    }

    try {
      // Responde o LOTE (tudo que o cliente mandou desde a última resposta),
      // não só a última mensagem. Sem lote, o próprio replyToPendingInbound
      // limpa o flag pra conversa não ficar em loop.
      const r = await replyToPendingInbound({
        conversationId: conv.id,
        leadId: conv.leadId,
        phone: conv.phone,
      });
      // processInboundWithAi ja limpa pendingAiResponse no patch de sucesso.
      // Se voltar 'after_hours_queued' aqui, eh porque o horario fechou de novo
      // entre o tick e a chamada — fica pending pro proximo tick.
      if (r && (r.status === 'replied' || r.status === 'qualified_and_replied')) {
        processed++;
      } else {
        skipped++;
      }
    } catch (err) {
      console.warn(`[ai-pending-worker] conv ${conv.id} failed:`, err instanceof Error ? err.message : err);
      skipped++;
    }
  }

  if (processed > 0 || skipped > 0) {
    console.log(`[ai-pending-worker] tick: processed=${processed} skipped=${skipped}`);
  }
  return { processed, skipped };
}
