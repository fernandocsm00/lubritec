import { and, eq } from 'drizzle-orm';
import { db } from '../../../db/client';
import { messages } from '../../../db/schema';
import { extractInbound } from '../../../lib/uazapiSchema';
import { INBOUND_MEDIA_FALLBACK_LABEL } from '@shared/types';

export interface RecoveredMessage {
  id: string;
  body: string;
}

/**
 * Recupera mensagens recebidas pela UazAPI gravadas como "📎 Mensagem não
 * suportada" antes de 25/09/2026. O texto nunca se perdeu: o webhook guarda o
 * corpo inteiro em raw_payload, e o extrator de hoje sabe ler template de empresa
 * e reação. Reprocessa esse payload e só toca em quem passa a ter outro texto.
 *
 * Idempotente: depois do apply a mensagem não tem mais o rótulo e sai da busca.
 */
export async function recoverUnsupportedInbound(opts: { apply: boolean }): Promise<{
  scanned: number;
  recovered: RecoveredMessage[];
}> {
  const rows = await db
    .select({ id: messages.id, rawPayload: messages.rawPayload })
    .from(messages)
    .where(
      and(
        eq(messages.provider, 'uazapi'),
        eq(messages.direction, 'in'),
        eq(messages.kind, 'unknown'),
        eq(messages.body, INBOUND_MEDIA_FALLBACK_LABEL.unknown),
      ),
    );

  const recovered: RecoveredMessage[] = [];
  for (const r of rows) {
    const payload = r.rawPayload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) continue;
    const body = extractInbound(payload as Record<string, unknown>)?.text;
    if (!body || body === INBOUND_MEDIA_FALLBACK_LABEL.unknown) continue;
    recovered.push({ id: r.id, body });
    if (opts.apply) {
      await db.update(messages).set({ body }).where(eq(messages.id, r.id));
    }
  }
  return { scanned: rows.length, recovered };
}
