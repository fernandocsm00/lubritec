import { eq, inArray, desc, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { campaignRecipients, campaigns, leads } from '../db/schema';
import { importLeadsFromCsvWithIds } from './leadsImport';
import type { CampaignAudienceImportResult } from '@shared/types';

/**
 * Para cada leadId que já foi recipient de alguma campanha, retorna a campanha
 * mais recente em que participou (nome + data). Leads sem participação anterior
 * não aparecem. "Data de participação" = COALESCE(sent_at, created_at).
 */
export async function findPreviousParticipation(
  leadIds: string[],
): Promise<CampaignAudienceImportResult['previouslyParticipated']> {
  if (leadIds.length === 0) return [];

  const rows = await db
    .select({
      leadId: campaignRecipients.leadId,
      cnpj: leads.cnpj,
      name: leads.name,
      campaignId: campaigns.id,
      campaignName: campaigns.name,
      participatedAt: sql<Date>`COALESCE(${campaignRecipients.sentAt}, ${campaignRecipients.createdAt})`,
    })
    .from(campaignRecipients)
    .innerJoin(leads, eq(leads.id, campaignRecipients.leadId))
    .innerJoin(campaigns, eq(campaigns.id, campaignRecipients.campaignId))
    .where(inArray(campaignRecipients.leadId, leadIds))
    .orderBy(desc(sql`COALESCE(${campaignRecipients.sentAt}, ${campaignRecipients.createdAt})`));

  // Rows vêm desc por data → o primeiro de cada lead é a campanha mais recente.
  const seen = new Set<string>();
  const result: CampaignAudienceImportResult['previouslyParticipated'] = [];
  for (const r of rows) {
    if (seen.has(r.leadId)) continue;
    seen.add(r.leadId);
    result.push({
      leadId: r.leadId,
      cnpj: r.cnpj,
      name: r.name,
      lastCampaign: {
        id: r.campaignId,
        name: r.campaignName,
        participatedAt: new Date(r.participatedAt as unknown as string).toISOString(),
      },
    });
  }
  return result;
}

/**
 * Import de audiência de campanha: roda o import de Cadastros (upsert por CNPJ)
 * e devolve os leadIds importados, a contagem de duplicados no arquivo e a lista
 * de CNPJs que já participaram de campanha anterior.
 */
export async function importCampaignAudience(
  buf: Buffer,
  userId: string,
): Promise<CampaignAudienceImportResult> {
  const { report, leadIds } = await importLeadsFromCsvWithIds(buf, { userId });
  const previouslyParticipated = await findPreviousParticipation(leadIds);
  const duplicatesInFileCount = report.rejected.filter((r) => /duplicad/i.test(r.reason)).length;
  return { report, importedLeadIds: leadIds, duplicatesInFileCount, previouslyParticipated };
}
