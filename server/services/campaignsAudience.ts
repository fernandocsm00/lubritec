import { db } from '../db/client';
import { leads } from '../db/schema';
import { and, or, eq, lte, inArray, notInArray, sql, type SQL } from 'drizzle-orm';
import type { AudienceFilters, CampaignDryRunResponse } from '@shared/types';

const PREVIEW_LIMIT = 5;

function buildWhere(filter: AudienceFilters): SQL | undefined {
  const conds: SQL[] = [];

  if (filter.status?.length) conds.push(inArray(leads.status, filter.status));
  if (filter.source?.length) conds.push(inArray(leads.source, filter.source));
  if (filter.lastPurchaseDaysAgo != null && filter.lastPurchaseDaysAgo >= 0) {
    conds.push(sql`(
      ${leads.lastPurchaseDate} IS NULL
      OR ${leads.lastPurchaseDate} <= now() - interval '${sql.raw(String(filter.lastPurchaseDaysAgo))} days'
    )`);
  }
  if (filter.excludeLeadIds?.length) {
    conds.push(notInArray(leads.id, filter.excludeLeadIds));
  }

  if (filter.phoneCsv?.length) {
    const baseCondition = conds.length ? and(...conds) : undefined;
    const phoneCondition = inArray(leads.phone, filter.phoneCsv);
    if (baseCondition) {
      return or(baseCondition, phoneCondition);
    }
    return phoneCondition;
  }

  return conds.length ? and(...conds) : undefined;
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
      vehicleModel: leads.vehicleModel,
      vehiclePlate: leads.vehiclePlate,
      lastPurchaseDate: leads.lastPurchaseDate,
    })
    .from(leads)
    .where(where)
    .limit(PREVIEW_LIMIT);

  return {
    total,
    preview: previewRows.map((r) => ({
      leadId: r.leadId,
      name: r.name,
      phone: r.phone,
      vehicleModel: r.vehicleModel,
      vehiclePlate: r.vehiclePlate,
      lastPurchaseDate: r.lastPurchaseDate,
    })),
  };
}

export async function resolveAudience(filter: AudienceFilters): Promise<Array<{ leadId: string; phone: string }>> {
  const where = buildWhere(filter);
  const rows = await db
    .select({ id: leads.id, phone: leads.phone })
    .from(leads)
    .where(where);
  return rows.map((r) => ({ leadId: r.id, phone: r.phone }));
}
