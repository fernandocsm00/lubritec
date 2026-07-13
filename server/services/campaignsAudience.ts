import { db } from '../db/client';
import { leads } from '../db/schema';
import { and, eq, isNotNull, lte, inArray, notInArray, sql, type SQL } from 'drizzle-orm';
import type { AudienceFilters, CampaignDryRunResponse } from '@shared/types';
import { filterEligibleLeads } from './campaignsCooldown';
import { toCanonicalBrPhone } from '../lib/phoneBR';

void eq; void lte;

const PREVIEW_PAGE_SIZE_DEFAULT = 50;
const PREVIEW_PAGE_SIZE_MAX = 200;
const ELIGIBLE_IDS_CAP = 10_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// excludeLeadIds pode conter ids sintéticos de leads NOVOS do CSV (ex.:
// "new:5511..."), que não são leads reais. Filtra pra só UUIDs válidos antes de
// usar em notInArray(leads.id) — senão o Postgres estoura ao castar pra uuid.
function realLeadIds(ids: string[] | undefined): string[] {
  return (ids ?? []).filter((id) => UUID_RE.test(id));
}

/**
 * Quando o usuario sobe um CSV de telefones, a audiencia da campanha passa a
 * ser EXATAMENTE os telefones do CSV — a intencao e "disparar pra essa lista".
 * Por isso os filtros de status/origem/dias sao IGNORADOS enquanto ha CSV
 * (nao faz sentido cruzar com status de leads que ainda nem existem). O opt-out
 * manual (excludeLeadIds) continua valendo.
 */
function buildWhere(filter: AudienceFilters, csvActive: boolean): SQL | undefined {
  const conds: SQL[] = [
    // Campanhas SEMPRE excluem leads sem telefone (não dá pra disparar).
    isNotNull(leads.phone),
  ];

  if (!csvActive) {
    if (filter.status?.length) conds.push(inArray(leads.status, filter.status));
    if (filter.source?.length) conds.push(inArray(leads.source, filter.source));
    if (filter.daysSinceCreated != null && filter.daysSinceCreated >= 0) {
      conds.push(sql`${leads.createdAt} <= now() - interval '${sql.raw(String(filter.daysSinceCreated))} days'`);
    }
  }

  const excludeIds = realLeadIds(filter.excludeLeadIds);
  if (excludeIds.length) {
    conds.push(notInArray(leads.id, excludeIds));
  }

  return and(...conds);
}

/**
 * Canonicaliza (E.164 BR com 9) e deduplica os telefones do CSV, descartando
 * os invalidos. Retorna null quando nao ha CSV. Um Set VAZIO (CSV presente mas
 * todos os telefones invalidos) resulta em audiencia vazia — nao "sem filtro".
 */
function csvCanonicalSet(filter: AudienceFilters): Set<string> | null {
  if (!filter.phoneCsv?.length) return null;
  const set = new Set<string>();
  for (const p of filter.phoneCsv) {
    const c = toCanonicalBrPhone(p);
    if (c) set.add(c);
  }
  return set;
}

export interface DryRunOpts {
  page?: number;
  pageSize?: number;
}

export async function dryRun(filter: AudienceFilters, opts: DryRunOpts = {}): Promise<CampaignDryRunResponse> {
  const csvSet = csvCanonicalSet(filter);
  const where = buildWhere(filter, csvSet !== null);

  // Telefones do CSV que nao normalizaram (formato invalido) — nao entram na
  // audiencia, mas contamos pra avisar o operador.
  const invalidFromCsv = (filter.phoneCsv ?? []).filter((p) => toCanonicalBrPhone(p) === null).length;

  const rawRows = await db
    .select({
      leadId: leads.id,
      name: leads.name,
      phone: leads.phone,
      cnpj: leads.cnpj,
      createdAt: leads.createdAt,
    })
    .from(leads)
    .where(where);

  // Leads existentes que casam com a audiencia. Para CSV, normalizamos OS DOIS
  // lados (telefone do lead e telefone do CSV) porque a base tem formatos
  // mistos (legado sem o 9, sem o 55) e comparacao literal perderia matches.
  type Row = { leadId: string; name: string; phone: string; cnpj: string | null; createdAt: Date };
  let existingRows: Row[] = rawRows.filter((r): r is Row => r.phone !== null);

  // Telefones do CSV que ainda NAO sao lead — serao criados na criacao da
  // campanha. No preview so contamos (nada e gravado aqui).
  let newPhones: string[] = [];

  if (csvSet) {
    const matched = new Set<string>();
    existingRows = existingRows.filter((r) => {
      const c = toCanonicalBrPhone(r.phone);
      if (c && csvSet.has(c)) {
        matched.add(c);
        return true;
      }
      return false;
    });
    newPhones = [...csvSet].filter((c) => !matched.has(c));
  }

  const newFromCsv = newPhones.length;

  const ids = existingRows.map((r) => r.leadId);
  const { eligible, blocked } = await filterEligibleLeads(ids, {});

  const blockReasonByLead = new Map<string, 'recent_outbound' | 'pending_other_campaign'>();
  for (const b of blocked) {
    blockReasonByLead.set(b.leadId, b.reason);
  }

  const eligibleSet = new Set(eligible);

  // Linhas de preview: existentes (com blockReason) + sinteticas pros telefones
  // novos (sempre elegiveis, sem lead ainda). Elegiveis primeiro pra paginacao.
  const now = new Date();
  const existingPreview = existingRows.map((r) => ({
    leadId: r.leadId,
    name: r.name,
    phone: r.phone,
    cnpj: r.cnpj,
    createdAt: r.createdAt,
    blockReason: blockReasonByLead.get(r.leadId) ?? null,
    isNew: false,
    eligible: eligibleSet.has(r.leadId),
  }));
  const newPreview = newPhones.map((phone) => ({
    leadId: `new:${phone}`,
    name: phone,
    phone,
    cnpj: null as string | null,
    createdAt: now,
    blockReason: null as CampaignDryRunResponse['preview'][number]['blockReason'],
    isNew: true,
    eligible: true,
  }));

  const sortedRows = [...existingPreview, ...newPreview].sort((a, b) => {
    if (a.eligible === b.eligible) return 0;
    return a.eligible ? -1 : 1; // elegiveis primeiro
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

  // total e eligible incluem os telefones novos (que serao criados e disparados).
  const total = existingRows.length + newFromCsv;
  const eligibleCount = eligible.length + newFromCsv;

  // eligibleIds: só ids REAIS de leads existentes elegíveis (os novos ainda não
  // têm id e não podem ser individualmente excluídos antes de criados).
  const eligibleIds = eligible.length <= ELIGIBLE_IDS_CAP ? eligible : [];

  return {
    total,
    eligible: eligibleCount,
    blocked: blockedCounts,
    eligibleIds,
    page,
    pageSize,
    pageCount,
    newFromCsv,
    invalidFromCsv,
    preview: previewRows.map((r) => ({
      leadId: r.leadId,
      name: r.name,
      phone: r.phone,
      cnpj: r.cnpj,
      createdAt: r.createdAt.toISOString(),
      blockReason: r.blockReason,
      isNew: r.isNew,
    })),
  };
}

export async function resolveAudience(filter: AudienceFilters): Promise<Array<{ leadId: string; phone: string }>> {
  const csvSet = csvCanonicalSet(filter);
  const where = buildWhere(filter, csvSet !== null);
  const rows = await db
    .select({ id: leads.id, phone: leads.phone })
    .from(leads)
    .where(where);

  let out = rows.filter((r): r is typeof r & { phone: string } => r.phone !== null);
  if (csvSet) {
    out = out.filter((r) => {
      const c = toCanonicalBrPhone(r.phone);
      return c !== null && csvSet.has(c);
    });
  }
  return out.map((r) => ({ leadId: r.id, phone: r.phone }));
}

/**
 * Cria como leads os telefones do CSV que ainda nao existem na base (comparacao
 * por telefone CANONICO, pra nao duplicar leads legados gravados sem o 9/55).
 * Leads criados: phone canonico, name = telefone, source='csv', status='frio',
 * flowStage='complete' (tem telefone). Sem CNPJ, sem enriquecimento, sem
 * auto-enroll na continua — sao contatos "crus" so pra receber a campanha.
 *
 * Idempotente: rodar duas vezes com o mesmo CSV nao recria os ja existentes.
 * Retorna quantos leads foram criados.
 */
export async function materializeCsvLeads(filter: AudienceFilters): Promise<number> {
  const csvSet = csvCanonicalSet(filter);
  if (!csvSet || csvSet.size === 0) return 0;

  const existingRows = await db
    .select({ phone: leads.phone })
    .from(leads)
    .where(isNotNull(leads.phone));

  const existingCanonical = new Set<string>();
  for (const r of existingRows) {
    const c = toCanonicalBrPhone(r.phone);
    if (c) existingCanonical.add(c);
  }

  const missing = [...csvSet].filter((c) => !existingCanonical.has(c));
  if (missing.length === 0) return 0;

  await db.insert(leads).values(
    missing.map((phone) => ({
      name: phone,
      phone,
      source: 'csv' as const,
      status: 'frio' as const,
      flowStage: 'complete' as const,
    })),
  );

  return missing.length;
}
