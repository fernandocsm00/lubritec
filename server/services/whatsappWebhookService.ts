import { db } from '../db/client';
import { conversations, messages, leads } from '../db/schema';
import { eq, sql } from 'drizzle-orm';
import type { UazapiInbound } from '../lib/uazapiSchema';
import type { MessageKind } from '@shared/types';

function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, '');
}

function detectKind(type: string | undefined): MessageKind {
  switch (type) {
    case 'text': return 'text';
    case 'image': return 'image';
    case 'audio': return 'audio';
    case 'video': return 'video';
    case 'document': return 'document';
    default: return 'unknown';
  }
}

export async function ingestInbound(
  payload: UazapiInbound,
  rawPayload: unknown,
): Promise<{ status: 'inserted' | 'duplicate' | 'ignored' }> {
  if (payload.event !== 'message.received' || !payload.message) {
    return { status: 'ignored' };
  }
  const m = payload.message;

  // Idempotência por uazapi_msg_id
  const existing = await db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.uazapiMsgId, m.id))
    .limit(1);
  if (existing.length) return { status: 'duplicate' };

  const phone = normalizePhone(m.from);
  const sentAt = m.timestamp;
  const kind = detectKind(typeof m.type === 'string' ? m.type : undefined);

  await db.transaction(async (tx) => {
    // 1. Match ou cria lead. Em caso de race (UNIQUE violation), refaz a query.
    let leadId: string;
    const found = await tx.select({ id: leads.id }).from(leads).where(eq(leads.phone, phone)).limit(1);
    if (found.length) {
      leadId = found[0].id;
    } else {
      try {
        const [created] = await tx
          .insert(leads)
          .values({ name: phone, phone, source: 'whatsapp', status: 'frio' })
          .returning({ id: leads.id });
        leadId = created.id;
      } catch (err) {
        // Race: outra request criou simultaneamente. Refaz a query.
        const pgErr = ((err as { cause?: unknown })?.cause ?? err) as { code?: string };
        if (pgErr?.code === '23505') {
          const retry = await tx.select({ id: leads.id }).from(leads).where(eq(leads.phone, phone)).limit(1);
          if (!retry.length) throw err;
          leadId = retry[0].id;
        } else {
          throw err;
        }
      }
    }

    // 2. Upsert conversation
    const existingConv = await tx
      .select()
      .from(conversations)
      .where(eq(conversations.phone, phone))
      .limit(1);

    let conversationId: string;
    if (existingConv.length === 0) {
      const [created] = await tx
        .insert(conversations)
        .values({
          phone,
          leadId,
          queue: 'recepcao',
          status: 'aguardando_atendimento',
          originKind: 'organic',
          lastMessageAt: sentAt,
          lastInboundAt: sentAt,
          unreadCount: 1,
        })
        .returning({ id: conversations.id });
      conversationId = created.id;
    } else {
      const c = existingConv[0];
      conversationId = c.id;
      const newStatus =
        c.status === 'encerrada' ? 'aguardando_atendimento' as const : c.status;
      await tx
        .update(conversations)
        .set({
          status: newStatus,
          lastMessageAt: sentAt,
          lastInboundAt: sentAt,
          unreadCount: sql`${conversations.unreadCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(conversations.id, c.id));
    }

    // 3. Insert message
    await tx.insert(messages).values({
      conversationId,
      direction: 'in',
      kind,
      body: kind === 'text' ? (m.text ?? null) : null,
      mediaUrl: m.media_url ?? null,
      mediaMime: m.mimetype ?? null,
      uazapiMsgId: m.id,
      rawPayload: rawPayload as object,
      sentAt,
    });
  });

  return { status: 'inserted' };
}
