import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { conversations, messages } from '../db/schema';
import { createKeyedDebouncer } from '../lib/keyedDebounce';
import { processInboundWithAi, type ProcessResult } from './aiAtendimento';

/**
 * Resposta da IA por LOTE: espera o cliente parar de digitar e responde tudo
 * de uma vez.
 *
 * Antes cada mensagem inbound disparava a IA na hora, em paralelo. Lead que
 * escreve em pedaços ("bom dia" / "tudo bem" / "queria falar com um vendedor")
 * recebia uma resposta por pedaço — 4 pedaços, 4 saudações. Relatado pela
 * operação em 25/09/2026.
 *
 * Fluxo: o webhook chama `scheduleAiReply` a cada texto; a espera recomeça a
 * cada chamada. Quando o cliente fica `AI_BATCH_WAIT_MS` em silêncio, junta
 * tudo que ele mandou desde a última resposta e chama a IA uma vez só.
 *
 * A espera vive em memória. Se o processo cair nela, o `pending_ai_response`
 * setado na ingestão segura a conversa e o aiPendingWorker responde o lote.
 */
const AI_BATCH_WAIT_MS = 2 * 60_000;

/** Override via env AI_BATCH_WAIT_MS (ms). */
export function aiBatchWaitMs(): number {
  const raw = process.env.AI_BATCH_WAIT_MS;
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : AI_BATCH_WAIT_MS;
}

export interface AiReplyTarget {
  conversationId: string;
  leadId: string;
  phone: string;
}

export interface InboundBatch {
  /** Textos do cliente, na ordem, um por linha. */
  text: string;
  /** Fronteira: até onde a última resposta nossa cobriu (null = nunca respondemos). */
  since: Date | null;
  /** Momento da última mensagem do lote. */
  until: Date;
}

/** Até onde uma resposta cobriu: a IA grava `coveredUntil`; o resto vale pelo envio. */
function coveredUntil(reply: { sentAt: Date; rawPayload: unknown }): Date {
  const raw = (reply.rawPayload as { coveredUntil?: unknown } | null)?.coveredUntil;
  if (typeof raw === 'string') {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return reply.sentAt;
}

/** O que o cliente mandou de texto desde a última resposta nossa. */
export async function collectInboundBatch(conversationId: string): Promise<InboundBatch | null> {
  // Aviso de fora do horário não responde nada: o cliente segue esperando
  // resposta pro que mandou antes dele, então não serve de fronteira.
  const [lastReply] = await db
    .select({ sentAt: messages.sentAt, rawPayload: messages.rawPayload })
    .from(messages)
    .where(and(
      eq(messages.conversationId, conversationId),
      eq(messages.direction, 'out'),
      sql`coalesce(${messages.rawPayload}->>'afterHours', 'false') <> 'true'`,
    ))
    .orderBy(desc(messages.sentAt))
    .limit(1);
  const since = lastReply ? coveredUntil(lastReply) : null;

  const inbound = await db
    .select({ body: messages.body, sentAt: messages.sentAt })
    .from(messages)
    .where(and(
      eq(messages.conversationId, conversationId),
      eq(messages.direction, 'in'),
      eq(messages.kind, 'text'),
      ...(since ? [gt(messages.sentAt, since)] : []),
    ))
    .orderBy(asc(messages.sentAt));

  const texts = inbound.filter((m) => m.body?.trim());
  if (texts.length === 0) return null;
  return {
    text: texts.map((m) => m.body!.trim()).join('\n'),
    since,
    until: texts[texts.length - 1].sentAt,
  };
}

// Conversas com a IA rodando agora (Gemini + digitação humanizada).
const running = new Set<string>();

/** Junta o lote pendente e chama a IA uma vez. null = nada pra responder. */
export async function replyToPendingInbound(target: AiReplyTarget): Promise<ProcessResult | null> {
  const id = target.conversationId;
  // Uma rodada por conversa: se a anterior ainda está no ar, esta volta pra
  // espera em vez de responder em paralelo — o que ela traria cai no lote novo.
  if (running.has(id)) {
    scheduleAiReply(target);
    return null;
  }
  running.add(id);
  try {
    const batch = await collectInboundBatch(id);
    if (!batch) {
      await db
        .update(conversations)
        .set({ pendingAiResponse: false, updatedAt: new Date() })
        .where(and(eq(conversations.id, id), eq(conversations.pendingAiResponse, true)));
      return null;
    }
    return await processInboundWithAi({
      ...target,
      inboundText: batch.text,
      turn: { since: batch.since, until: batch.until },
    });
  } finally {
    running.delete(id);
  }
}

const debouncer = createKeyedDebouncer<AiReplyTarget>(aiBatchWaitMs, (_id, target) => {
  replyToPendingInbound(target)
    .then((r) => {
      if (!r) return;
      if (r.status === 'gemini_error' || r.status === 'send_error') {
        console.error('[ai] processInbound failed:', r.status, r.errorMessage);
      } else {
        console.log('[ai] processInbound:', r.status);
      }
    })
    .catch((err) => {
      console.error('[ai] processInbound threw:', err);
    });
});

/** (Re)começa a espera da conversa. Chamado pelo webhook a cada texto recebido. */
export function scheduleAiReply(target: AiReplyTarget): void {
  debouncer.schedule(target.conversationId, target);
}

export function cancelScheduledAiReply(conversationId: string): void {
  debouncer.cancel(conversationId);
}

/** Esperando o silêncio ou respondendo agora, neste processo. */
export function isAiReplyInFlight(conversationId: string): boolean {
  return debouncer.has(conversationId) || running.has(conversationId);
}
