import { db } from '../db/client';
import { leads } from '../db/schema';
import { and, or, eq, isNotNull, lte, inArray, notInArray, sql, type SQL } from 'drizzle-orm';
import type { AudienceFilters, CampaignDryRunResponse } from '@shared/types';
import { filterEligibleLeads } from './campaignsCooldown';

void eq; void lte;

const PREVIEW_PAGE_SIZE_DEFAULT = 50;
const PREVIEW_PAGE_SIZE_MAX = 200;
const ELIGIBLE_IDS_CAP = 10_000;

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

export interface DryRunOpts {
  page?: number;
  pageSize?: number;
}

export async function dryRun(filter: AudienceFilters, opts: DryRunOpts = {}): Promise<CampaignDryRunResponse> {
  const where = buildWhere(filter);

  const allRows = await db
    .select({
      leadId: leads.id,
      name: leads.name,
      phone: leads.phone,
      cnpj: leads.cnpj,
      createdAt: leads.createdAt,
    })
    .from(leads)
    .where(where);

  const total = allRows.length;
  const ids = allRows.map((r) => r.leadId);
  const { eligible, blocked } = await filterEligibleLeads(ids, {});

  // Mapa leadId -> reason pra anotar no preview.
  const blockReasonByLead = new Map<string, 'recent_outbound' | 'pending_other_campaign'>();
  for (const b of blocked) {
    blockReasonByLead.set(b.leadId, b.reason);
  }

  // Preview agora inclui BLOQUEADOS junto com elegiveis -- usuario precisa ver
  // quem nao vai receber (e por que) antes de confirmar a campanha. Ordena
  // elegiveis primeiro pra paginacao consistente.
  const eligibleSet = new Set(eligible);
  const sortedRows = [...allRows]
    .filter((r): r is typeof r & { phone: string } => r.phone !== null)
    .sort((a, b) => {
      const aBlocked = !eligibleSet.has(a.leadId);
      const bBlocked = !eligibleSet.has(b.leadId);
      if (aBlocked === bBlocked) return 0;
      return aBlocked ? 1 : -1; // elegiveis primeiro
    });

  const pageSize = Math.min(PREVIEW_PAGE_SIZE_MAX, Math.max(1, opts.pageSize ?? PREVIEW_PAGE_SIZE_DEFAULT));
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const page = Math.min(pageCount, Math.max(1, opts.page ?? 1));
  const previewRows = sortedRows.slice((page - 1) * pageSize, page * pageSize);

  const blockedCounts = blocked.reduce(
    (acc, b) => {
      if (b.reason === 'recent_outbound') acc.recentOutbound++;
      else acc.pendingOtherCampaign++;
      return acc;
    },
    { recentOutbound: 0, pendingOtherCampaign: 0 },
  );

  // eligibleIds: lista completa pra "marcar/desmarcar todos" no frontend
  // sem precisar buscar pagina por pagina. Cap pra evitar payload absurdo
  // em audiencias gigantes (improvavel, mas defensivo).
  const eligibleIds = eligible.length <= ELIGIBLE_IDS_CAP ? eligible : [];

  return {
    total,
    eligible: eligible.length,
    blocked: blockedCounts,
    eligibleIds,
    page,
    pageSize,
    pageCount,
    preview: previewRows.map((r) => ({
      leadId: r.leadId,
      name: r.name,
      phone: r.phone,
      cnpj: r.cnpj,
      createdAt: r.createdAt.toISOString(),
      blockReason: blockReasonByLead.get(r.leadId) ?? null,
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
