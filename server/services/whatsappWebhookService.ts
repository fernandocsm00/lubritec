import { db } from '../db/client';
import { conversations, messages, leads } from '../db/schema';
import { eq, sql } from 'drizzle-orm';
import type { InboundMessage } from '../lib/uazapiSchema';

function normalizePhone(raw: string): string {
  // Remove tudo que não é dígito. Funciona pra "+55 11 9...", "5511...@s.whatsapp.net", "5511...@c.us", etc.
  return raw.replace(/\D/g, '');
}

export async function ingestInbound(
  m: InboundMessage,
  rawPayload: unknown,
): Promise<{ status: 'inserted' | 'duplicate' | 'ignored' }> {
  // Idempotência por uazapi_msg_id
  const existing = await db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.uazapiMsgId, m.id))
    .limit(1);
  if (existing.length) return { status: 'duplicate' };

  const phone = normalizePhone(m.from);
  if (phone.length < 8) return { status: 'ignored' };

  const sentAt = m.timestamp;

  // Stages "anteriores" a engaged — recebimento de inbound deve promover daqui pra engaged.
  // Stages mais avançados (qualified, handed_off, lost) são preservados.
  const PROMOTABLE_TO_ENGAGED = new Set(['incomplete', 'complete', 'dispatched']);

  await db.transaction(async (tx) => {
    // 1. Match ou cria lead. Em caso de race (UNIQUE violation), refaz a query.
    let leadId: string;
    const found = await tx
      .select({ id: leads.id, name: leads.name, flowStage: leads.flowStage })
      .from(leads)
      .where(eq(leads.phone, phone))
      .limit(1);
    if (found.length) {
      leadId = found[0].id;
      const updates: Partial<typeof leads.$inferInsert> = {};
      // Promove nome auto-gerado pro pushName real (não sobrescreve customizado).
      if (m.contactName && found[0].name === phone) {
        updates.name = m.contactName;
      }
      // Promove stage pra 'engaged' se ainda estiver em estágio anterior.
      if (PROMOTABLE_TO_ENGAGED.has(found[0].flowStage)) {
        updates.flowStage = 'engaged';
      }
      if (Object.keys(updates).length > 0) {
        updates.updatedAt = new Date();
        await tx.update(leads).set(updates).where(eq(leads.id, leadId));
      }
    } else {
      try {
        const [created] = await tx
          .insert(leads)
          .values({
            name: m.contactName ?? phone,
            phone,
            source: 'whatsapp',
            status: 'frio',
            // Lead novo via inbound: já interagiu por definição.
            flowStage: 'engaged',
          })
          .returning({ id: leads.id });
        leadId = created.id;
      } catch (err) {
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
      kind: m.kind,
      body: m.kind === 'text' ? m.text : null,
      mediaUrl: m.mediaUrl,
      mediaMime: m.mediaMime,
      uazapiMsgId: m.id,
      rawPayload: rawPayload as object,
      sentAt,
    });
  });

  return { status: 'inserted' };
}
