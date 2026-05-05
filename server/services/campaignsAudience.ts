import { db } from '../db/client';
import { leads } from '../db/schema';
import { and, or, eq, isNotNull, lte, inArray, notInArray, sql, type SQL } from 'drizzle-orm';
import type { AudienceFilters, CampaignDryRunResponse } from '@shared/types';

void eq; void lte;

const PREVIEW_LIMIT = 5;

function buildWhere(filter: AudienceFilters): SQL | undefined {
  const conds: SQL[] = [
    // Campanhas SEMPRE excluem leads sem telefone (não dá pra disparar).
    isNotNull(leads.phone),
  ];

  if (filter.status?.length) conds.push(inArray(leads.status, filter.status));
  if (filter.source?.length) conds.push(inArray(leads.source, filter.source));
  if (filter.daysSinceCreated != null && filter.daysSinceCreated >= 0) {
    conds.push(sql`${leads.createdAt} <= now() - interval '${sql.raw(String(filter.daysSinceCreated))} days'`);
  }
  if (filter.excludeLeadIds?.length) {
    conds.push(notInArray(leads.id, filter.excludeLeadIds));
  }

  if (filter.phoneCsv?.length) {
    const baseCondition = and(...conds);
    const phoneCondition = and(isNotNull(leads.phone), inArray(leads.phone, filter.phoneCsv));
    if (baseCondition) {
      return or(baseCondition, phoneCondition);
    }
    return phoneCondition;
  }

  return and(...conds);
}

export async function dryRun(filter: AudienceFilters): Promise<CampaignDryRunResponse> {
  const where = buildWhere(filter);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(leads)
    .where(where);

  const previewRows = await db
    .select({
      leadId: leads.id,
      name: leads.name,
      phone: leads.phone,
      cnpj: leads.cnpj,
      createdAt: leads.createdAt,
    })
    .from(leads)
    .where(where)
    .limit(PREVIEW_LIMIT);

  return {
    total,
    // O where filtra `phone IS NOT NULL` — assert é seguro aqui.
    preview: previewRows
      .filter((r): r is typeof r & { phone: string } => r.phone !== null)
      .map((r) => ({
        leadId: r.leadId,
        name: r.name,
        phone: r.phone,
        cnpj: r.cnpj,
        createdAt: r.createdAt.toISOString(),
      })),
  };
}

export async function resolveAudience(filter: AudienceFilters): Promise<Array<{ leadId: string; phone: string }>> {
  const where = buildWhere(filter);
  const rows = await db
    .select({ id: leads.id, phone: leads.phone })
    .from(leads)
    .where(where);
  return rows
    .filter((r): r is typeof r & { phone: string } => r.phone !== null)
    .map((r) => ({ leadId: r.id, phone: r.phone }));
}
