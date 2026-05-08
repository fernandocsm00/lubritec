import { db } from '../db/client';
import { sql } from 'drizzle-orm';

export const COOLDOWN_HOURS = 24;
export const COOLDOWN_REASON = 'cooldown_24h';

export type CooldownReason = 'recent_outbound' | 'pending_other_campaign';

export interface CooldownBlock {
  leadId: string;
  reason: CooldownReason;
}

export interface FilterResult {
  eligible: string[];
  blocked: CooldownBlock[];
}

/**
 * Para cada leadId em entrada, classifica como elegível ou bloqueado:
 *
 *  (A) recent_outbound — existe messages.direction='out' nas últimas 24h
 *      em alguma conversa do lead. Origem irrelevante (campanha/operador/IA).
 *  (B) pending_other_campaign — existe campaign_recipients pendente em
 *      campanha running/scheduled diferente da informada em excludeCampaignId.
 *
 * Precedência: recent_outbound > pending_other_campaign.
 *
 * Implementação: 1 query só por chamada (subqueries EXISTS), sem N round-trips.
 */
export async function filterEligibleLeads(
  leadIds: string[],
  opts: { excludeCampaignId?: string },
): Promise<FilterResult> {
  if (leadIds.length === 0) return { eligible: [], blocked: [] };

  // Build the UUID array literal as raw SQL to avoid Drizzle parameter-binding
  // issues with arrays. Each UUID is validated by the DB via ::uuid cast.
  const uuidArrayLiteral = `'{${leadIds.join(',')}}'::uuid[]`;

  const result = await db.execute(sql`
    SELECT
      i.lead_id::text AS lead_id,
      EXISTS (
        SELECT 1
        FROM conversations c
        JOIN messages m ON m.conversation_id = c.id
        WHERE c.lead_id = i.lead_id
          AND m.direction = 'out'
          AND m.sent_at > now() - interval '${sql.raw(String(COOLDOWN_HOURS))} hours'
      ) AS recent_outbound,
      EXISTS (
        SELECT 1
        FROM campaign_recipients cr
        JOIN campaigns ca ON ca.id = cr.campaign_id
        WHERE cr.lead_id = i.lead_id
          AND cr.status = 'pending'
          AND ca.status IN ('running', 'scheduled')
          AND (${opts.excludeCampaignId ?? null}::uuid IS NULL
               OR ca.id <> ${opts.excludeCampaignId ?? null}::uuid)
      ) AS pending_other
    FROM unnest(${sql.raw(uuidArrayLiteral)}) AS i(lead_id)
  `);

  const rows = result.rows as Array<{
    lead_id: string;
    recent_outbound: boolean;
    pending_other: boolean;
  }>;

  const eligible: string[] = [];
  const blocked: CooldownBlock[] = [];
  for (const r of rows) {
    if (r.recent_outbound) {
      blocked.push({ leadId: r.lead_id, reason: 'recent_outbound' });
    } else if (r.pending_other) {
      blocked.push({ leadId: r.lead_id, reason: 'pending_other_campaign' });
    } else {
      eligible.push(r.lead_id);
    }
  }
  return { eligible, blocked };
}
