import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { budgetDetections, conversations, messages } from '../db/schema';
import { extractBudgetFromImage } from './geminiClient';

/**
 * Le o print de orcamento que o vendedor acabou de mandar e, se encontrar um
 * total confiavel, grava uma sugestao PENDENTE pro painel do lead.
 *
 * Nunca lanca e nunca grava em deals: quem decide o numero que entra na previsao
 * de receita e o vendedor, confirmando o card. Ver
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

  await db.transaction(async (tx) => {
    // Orcamento revisado manda: a sugestao anterior deixa de valer.
    await tx
      .update(budgetDetections)
      .set({ status: 'dismissed', resolvedAt: new Date() })
      .where(and(
        eq(budgetDetections.leadId, row.leadId),
        eq(budgetDetections.status, 'pending'),
      ));

    await tx
      .insert(budgetDetections)
      .values({
        messageId: row.id,
        leadId: row.leadId,
        detectedValue: String(found.total),
        detectedLabel: found.rotulo,
      })
      .onConflictDoNothing();
  });
}
