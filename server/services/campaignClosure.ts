import { and, asc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { campaigns, dealActivities, deals } from '../db/schema';
import { emitNotification } from './notifications';

const HISTORY_URL_BASE = '/inside-sales?tab=history&stage=perdido&reason=campanha_encerrada&owner=mine';

/**
 * Fecha os cards ABERTOS de uma campanha: perdido, motivo "campanha_encerrada".
 *
 * Não passa por changeStage de propósito: lá o fechamento manual exige a
 * avaliação de qualidade do lead, que não existe numa automação. O histórico
 * do card recebe as mesmas atividades do fechamento manual (stage_changed +
 * lost), com actor = quem clicou em "Encerrar" ou null ("Sistema").
 *
 * Marca a campanha como varrida (cards_closed_at) na mesma transação: a rotina
 * automática nunca volta nela, então card reaberto com "Reativar" fica aberto.
 */
export async function closeCampaignCards(
  campaignId: string,
  actorUserId: string | null,
): Promise<{ closed: number }> {
  const [campaign] = await db
    .select({ id: campaigns.id, name: campaigns.name })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (!campaign) return { closed: 0 };

  const closedCards = await db.transaction(async (tx) => {
    const now = new Date();
    const open = await tx
      .select({ id: deals.id, stage: deals.stage, ownerUserId: deals.ownerUserId })
      .from(deals)
      .where(and(eq(deals.campaignId, campaignId), sql`${deals.stage} NOT IN ('ganho', 'perdido')`))
      .for('update');

    if (open.length > 0) {
      await tx
        .update(deals)
        .set({ stage: 'perdido', lossReason: 'campanha_encerrada', closedAt: now, updatedAt: now })
        .where(inArray(deals.id, open.map((d) => d.id)));
      await tx.insert(dealActivities).values(open.flatMap((d) => [
        {
          dealId: d.id,
          kind: 'stage_changed' as const,
          actorUserId,
          metadata: { from: d.stage, to: 'perdido', via: 'campaign_closed' },
        },
        {
          dealId: d.id,
          kind: 'lost' as const,
          actorUserId,
          metadata: { reason: 'campanha_encerrada', via: 'campaign_closed', campaignId },
        },
      ]));
    }

    await tx.update(campaigns).set({ cardsClosedAt: now }).where(eq(campaigns.id, campaignId));
    return open;
  });

  // Aviso ao dono (fora da transação; emitNotification é best-effort): quem
  // ainda negociava não é pego de surpresa e pode reativar pelo Histórico.
  const byOwner = new Map<string, number>();
  for (const c of closedCards) {
    if (c.ownerUserId) byOwner.set(c.ownerUserId, (byOwner.get(c.ownerUserId) ?? 0) + 1);
  }
  // Link filtrado pela campanha (spec §7: "filtrado pela campanha e pelo
  // motivo") — senão o dono cai no Histórico inteiro e precisa procurar entre
  // os perdidos de todas as campanhas.
  const actionUrl = `${HISTORY_URL_BASE}&campaignIds=${campaignId}`;
  for (const [userId, n] of byOwner) {
    await emitNotification({
      userIds: [userId],
      kind: 'campaign_cards_closed',
      title: 'Campanha encerrada',
      body: `${n} ${n === 1 ? 'card seu foi fechado' : 'cards seus foram fechados'}: campanha ${campaign.name} encerrou.`,
      actionUrl,
      metadata: { campaignId, closed: n },
    });
  }

  return { closed: closedCards.length };
}

/**
 * Varre as campanhas comuns com vigência vencida (validity_end < now) que ainda
 * não foram varridas. Contínuas não têm vigência e nunca entram; comuns sem
 * vigência (anteriores a 31/08/2026) também não — essas só pelo botão.
 */
export async function closeEndedCampaigns(
  now: Date = new Date(),
): Promise<{ campaigns: number; cards: number }> {
  const due = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(and(
      eq(campaigns.isContinuous, false),
      isNull(campaigns.cardsClosedAt),
      lt(campaigns.validityEnd, now),
    ))
    .orderBy(asc(campaigns.validityEnd));

  let cards = 0;
  for (const c of due) {
    // Campanha com erro não pode travar as outras — cada uma é independente:
    // segue pro próximo tick sozinha, o resto da varredura continua.
    try {
      cards += (await closeCampaignCards(c.id, null)).closed;
    } catch (err) {
      console.error(`[campaign-closure] campanha ${c.id} falhou:`, err);
    }
  }
  return { campaigns: due.length, cards };
}
