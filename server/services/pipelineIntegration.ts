import { db } from '../db/client';
import { conversations, deals } from '../db/schema';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { MessageKind } from '@shared/types';
import { createDeal, reactivateDeal } from './dealsService';

export async function maybeAddDealFromConversation(opts: {
  conversationId: string;
  messageKind: MessageKind;
  userId: string;
}): Promise<void> {
  if (opts.messageKind !== 'image') return;

  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, opts.conversationId))
    .limit(1);
  if (!conv || conv.queue !== 'comercial') return;

  // Lead com qualquer card aberto (de qualquer campanha) → nada a fazer.
  const [open] = await db
    .select({ id: deals.id })
    .from(deals)
    .where(and(eq(deals.leadId, conv.leadId), sql`${deals.stage} NOT IN ('ganho', 'perdido')`))
    .limit(1);
  if (open) return;

  const [latest] = await db
    .select({ id: deals.id })
    .from(deals)
    .where(eq(deals.leadId, conv.leadId))
    .orderBy(desc(deals.createdAt))
    .limit(1);

  if (!latest) {
    await createDeal({
      leadId: conv.leadId,
      // O card segue o dono da conversa, não quem mandou a imagem.
      ownerUserId: conv.assignedTo ?? opts.userId,
      source: 'auto_image',
    });
  } else {
    await reactivateDeal({ dealId: latest.id, actorUserId: opts.userId });
  }
}
