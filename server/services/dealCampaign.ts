import { sql } from 'drizzle-orm';
import { db } from '../db/client';

/**
 * Campanha a que um card NOVO pertence: a do último disparo recebido pelo lead,
 * se ainda estiver vigente.
 *
 * - Comum: vigente enquanto `validity_end >= now` — o instante do fim ainda vale,
 *   mesma regra do selo de vigência (src/features/campaigns/validity.ts).
 * - Contínua: sempre vigente. Dispara sem parar e não tem vigência.
 * - Comum sem vigência (anterior a 31/08/2026): não conta. Um disparo de meses
 *   atrás não é "a campanha" de uma qualificação de hoje.
 *
 * null = card sem campanha. Card nascer na campanha já encerrada seria card que
 * nasce perdido.
 */
export async function resolveQualificationCampaign(
  leadId: string,
  now: Date = new Date(),
): Promise<string | null> {
  const r = await db.execute<{
    campaign_id: string;
    is_continuous: boolean;
    validity_end: Date | string | null;
  }>(sql`
    SELECT cr.campaign_id::text AS campaign_id, c.is_continuous, c.validity_end
    FROM campaign_recipients cr
    JOIN campaigns c ON c.id = cr.campaign_id
    WHERE cr.lead_id = ${leadId}
      AND cr.sent_at IS NOT NULL
      AND cr.sent_at <= ${now}
    ORDER BY cr.sent_at DESC
    LIMIT 1
  `);
  const last = r.rows[0];
  if (!last) return null;
  if (last.is_continuous) return last.campaign_id;
  if (last.validity_end && new Date(last.validity_end).getTime() >= now.getTime()) {
    return last.campaign_id;
  }
  return null;
}

/**
 * Campanha a que a IA atribui um registro (ai_call_logs.campaign_id — calibração,
 * fila cega, "Não qualificados"): o último disparo recebido pelo lead, SEM olhar
 * vigência. Resposta tardia ainda é da campanha que a provocou. Sem disparo, cai
 * na campanha que abriu a conversa — o comportamento anterior a 28/09/2026.
 */
export async function lastDispatchedCampaign(
  leadId: string,
  fallbackCampaignId: string | null,
): Promise<string | null> {
  const r = await db.execute<{ campaign_id: string }>(sql`
    SELECT cr.campaign_id::text AS campaign_id
    FROM campaign_recipients cr
    WHERE cr.lead_id = ${leadId}
      AND cr.sent_at IS NOT NULL
      AND cr.sent_at <= now()
    ORDER BY cr.sent_at DESC
    LIMIT 1
  `);
  return r.rows[0]?.campaign_id ?? fallbackCampaignId;
}
