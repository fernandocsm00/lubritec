import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { budgetDetections, conversations, deals, messages } from '../db/schema';
import { extractBudgetFromImage } from './geminiClient';

/**
 * Le o print de orcamento que o vendedor acabou de mandar e, quando encontra um
 * total confiavel, aplica direto no card do pipeline: grava o valor da proposta
 * e avanca a etapa pra 'proposta_enviada'.
 *
 * Nunca lanca — roda num caminho best-effort pos-envio. Ver
 * docs/superpowers/specs/2026-08-05-orcamento-valor-no-pipeline-design.md
 */
export async function detectBudgetFromMessage(messageId: string): Promise<void> {
  const [row] = await db
    .select({
      id: messages.id,
      direction: messages.direction,
      kind: messages.kind,
      mediaUrl: messages.mediaUrl,
      mediaMime: messages.mediaMime,
      sentByUserId: messages.sentByUserId,
      leadId: conversations.leadId,
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(eq(messages.id, messageId))
    .limit(1);

  if (!row) return;
  // So imagem NOSSA. Imagem do cliente pode ser orcamento de concorrente.
  if (row.direction !== 'out' || row.kind !== 'image') return;
  if (!row.mediaUrl || !row.mediaUrl.startsWith('/uploads/')) return;

  let buffer: Buffer;
  try {
    // mediaUrl e /uploads/... ; o diretorio real e <cwd>/uploads/...
    const rel = row.mediaUrl.replace(/^\/uploads\//, '');
    buffer = await readFile(path.join(process.cwd(), 'uploads', rel));
  } catch (err) {
    console.warn('[budget] não consegui ler a imagem:', err instanceof Error ? err.message : err);
    return;
  }

  const found = await extractBudgetFromImage(buffer, row.mediaMime ?? 'image/jpeg');
  if (!found) return;

  const detectionId = await db.transaction(async (tx) => {
    // Orcamento revisado manda: a sugestao anterior deixa de valer.
    await tx
      .update(budgetDetections)
      .set({ status: 'dismissed', resolvedAt: new Date() })
      .where(and(
        eq(budgetDetections.leadId, row.leadId),
        eq(budgetDetections.status, 'pending'),
      ));

    const [inserted] = await tx
      .insert(budgetDetections)
      .values({
        messageId: row.id,
        leadId: row.leadId,
        detectedValue: String(found.total),
        detectedLabel: found.rotulo,
      })
      .onConflictDoNothing()
      .returning({ id: budgetDetections.id });

    // Sem linha = reprocessamento da mesma imagem (unique por message_id).
    return inserted?.id ?? null;
  });

  if (!detectionId) return;

  await applyToPipeline({
    detectionId,
    leadId: row.leadId,
    value: found.total,
    actorUserId: row.sentByUserId,
  });
}

/**
 * Escreve o valor lido no card do pipeline e avanca a etapa.
 *
 * Duas salvaguardas, ambas deliberadas:
 *
 * 1. So mexe em card ATIVO. Deal em 'ganho'/'perdido' guarda o numero da venda
 *    fechada — um print mandado depois nao pode sobrescrever isso.
 * 2. A etapa so ANDA PRA FRENTE. Orcamento revisado durante a negociacao
 *    atualiza o valor mas nao puxa o card de volta pra 'proposta_enviada'.
 *
 * Quando nao da pra aplicar, a deteccao fica 'pending' e o painel do lead mostra
 * o card de sugestao — o caminho manual continua existindo como rede.
 */
async function applyToPipeline(input: {
  detectionId: string;
  leadId: string;
  value: number;
  actorUserId: string | null;
}): Promise<void> {
  // Sem autor humano (disparo automatico) nao ha a quem atribuir a mudanca no
  // log do deal — vira sugestao em vez de escrita anonima no pipeline.
  if (!input.actorUserId) return;

  const [deal] = await db
    .select({ id: deals.id, stage: deals.stage })
    .from(deals)
    .where(and(
      eq(deals.leadId, input.leadId),
      sql`${deals.stage} NOT IN ('ganho', 'perdido')`,
    ))
    .limit(1);

  if (!deal) return;

  const { updateDeal, changeStage } = await import('./dealsService');

  await updateDeal({
    id: deal.id,
    actorUserId: input.actorUserId,
    proposalValue: input.value,
  });

  if (deal.stage === 'lead_no_comercial') {
    await changeStage({
      id: deal.id,
      actorUserId: input.actorUserId,
      stage: 'proposta_enviada',
    });
  }

  await db
    .update(budgetDetections)
    .set({
      status: 'confirmed',
      confirmedValue: String(input.value),
      resolvedBy: input.actorUserId,
      resolvedAt: new Date(),
    })
    .where(eq(budgetDetections.id, input.detectionId));
}
