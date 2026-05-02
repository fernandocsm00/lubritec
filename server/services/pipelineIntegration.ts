import { db } from '../db/client';
import { conversations, deals } from '../db/schema';
import { eq } from 'drizzle-orm';
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

  const [existing] = await db.select().from(deals).where(eq(deals.leadId, conv.leadId)).limit(1);

  if (!existing) {
    await createDeal({
      leadId: conv.leadId,
      ownerUserId: opts.userId,
      source: 'auto_image',
    });
  } else if (existing.stage === 'ganho' || existing.stage === 'perdido') {
    await reactivateDeal({ dealId: existing.id, actorUserId: opts.userId });
  }
  // else: deal ativo já existe — no-op
}
