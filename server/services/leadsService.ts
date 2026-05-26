import { db } from '../db/client';
import { leads, deals, type NewLead } from '../db/schema';
import { eq, and, or, ilike, desc, asc, sql, type AnyColumn } from 'drizzle-orm';
import { HttpError } from '../middleware/errorHandler';
import type { PublicLead, LeadStatus, LeadSource, LeadFlowStage, LeadEnrichmentResult, LeadQualityFeedback } from '@shared/types';
import { normalizeCnpj, isValidCnpjFormat } from '../lib/cnpj';
import { tryEnrollSafe } from './continuousCampaign';
import { recordTransition } from './stageTransitions';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, '');
}

function toPublic(row: typeof leads.$inferSelect & {
  hasDeal?: boolean;
  lastEnrichmentResult?: LeadEnrichmentResult | string | null;
}): PublicLead {
  // Defensivo: result_status no DB pode ter strings antigas/desconhecidas;
  // so retornamos os valores que o tipo conhece, resto vira null.
  const known: ReadonlyArray<LeadEnrichmentResult> = [
    'phone_found', 'phone_not_in_brasilapi', 'cnpj_not_found', 'cnpj_inactive', 'api_error',
  ];
  const result = row.lastEnrichmentResult && known.includes(row.lastEnrichmentResult as LeadEnrichmentResult)
    ? (row.lastEnrichmentResult as LeadEnrichmentResult)
    : null;
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    cnpj: row.cnpj,
    email: row.email,
    notes: row.notes,
    status: row.status,
    source: row.source,
    flowStage: row.flowStage,
    hasDeal: row.hasDeal ?? false,
    lastEnrichmentResult: result,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Calcula o flow_stage inicial pra um lead novo baseado nos dados disponíveis.
 * Útil pra createLead manual e CSV import. Webhook usa lógica própria
 * (sempre tem phone → 'engaged' ou 'complete' dependendo do contexto).
 */
function computeInitialStage(phone: string | null | undefined): 'incomplete' | 'complete' {
  return phone && phone.length >= 8 ? 'complete' : 'incomplete';
}

// ---------------------------------------------------------------------------
// createLead
// ---------------------------------------------------------------------------

export async function createLead(input: {
  name: string;
  phone?: string | null;
  cnpj: string;
  email?: string | null;
  notes?: string | null;
}): Promise<PublicLead> {
  // Phone agora é opcional pra suportar leads CNPJ-only (vão pra enriquecimento).
  const phoneRaw = input.phone ?? '';
  const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
  if (phone !== null && phone.length < 8) {
    throw new HttpError(400, 'Phone must have at least 8 digits');
  }

  const cnpj = normalizeCnpj(input.cnpj);
  if (!isValidCnpjFormat(cnpj)) throw new HttpError(400, 'CNPJ inválido');

  const [existing] = await db.select().from(leads).where(eq(leads.cnpj, cnpj)).limit(1);
  if (existing) throw new HttpError(409, 'CNPJ já cadastrado');

  // Race fix: if two requests pass the pre-check concurrently, the second insert
  // trips the unique constraint on cnpj. Translate the pg unique_violation
  // (23505) to the same 409 the pre-check would have thrown.
  try {
    const [row] = await db
      .insert(leads)
      .values({
        name: input.name,
        phone,
        cnpj,
        email: input.email ?? null,
        notes: input.notes ?? null,
        flowStage: computeInitialStage(phone),
      })
      .returning();
    // Audit trail: registra a transição inicial.
    await recordTransition({
      leadId: row.id,
      fromStage: null,
      toStage: row.flowStage,
      source: 'create',
    });
    // Lead criado com phone → enrolado automaticamente na campanha contínua.
    if (row.flowStage === 'complete') {
      await tryEnrollSafe(row.id);
    }
    return toPublic({ ...row, hasDeal: false });
  } catch (err) {
    const pgErr = (
      (err as { cause?: unknown })?.cause ?? err
    ) as { code?: string; constraint?: string };
    if (
      pgErr?.code === '23505' &&
      (pgErr.constraint === undefined || pgErr.constraint.includes('cnpj'))
    ) {
      throw new HttpError(409, 'CNPJ já cadastrado');
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// updateLead
// ---------------------------------------------------------------------------

export async function updateLead(input: {
  id: string;
  name?: string;
  email?: string | null;
  notes?: string | null;
  status?: LeadStatus;
  // CNPJ é editável APENAS se o lead ainda não tem CNPJ (caso de leads criados
  // automaticamente via WhatsApp inbound). Uma vez setado, vira imutável.
  cnpj?: string;
  // Phone é editável APENAS se o lead ainda não tem phone (caso de leads
  // CNPJ-only do CSV aguardando enriquecimento). Uma vez setado, imutável.
  phone?: string;
}): Promise<PublicLead> {
  const { id, ...rest } = input;
  const patch: Partial<NewLead> = { updatedAt: new Date() };
  if (rest.name !== undefined) patch.name = rest.name;
  if (rest.email !== undefined) patch.email = rest.email;
  if (rest.notes !== undefined) patch.notes = rest.notes;
  if (rest.status !== undefined) patch.status = rest.status;

  // Carrega o estado atual uma vez se vamos validar phone OU cnpj.
  const needsCurrent = rest.cnpj !== undefined || rest.phone !== undefined;
  let current: { cnpj: string | null; phone: string | null; flowStage: string } | undefined;
  if (needsCurrent) {
    [current] = await db
      .select({ cnpj: leads.cnpj, phone: leads.phone, flowStage: leads.flowStage })
      .from(leads)
      .where(eq(leads.id, id))
      .limit(1);
    if (!current) throw new HttpError(404, 'Lead not found');
  }

  if (rest.cnpj !== undefined) {
    if (current!.cnpj && current!.cnpj.length > 0) {
      throw new HttpError(400, 'CNPJ cannot be edited');
    }
    const cnpj = normalizeCnpj(rest.cnpj);
    if (!isValidCnpjFormat(cnpj)) throw new HttpError(400, 'CNPJ inválido');
    const [dup] = await db.select({ id: leads.id }).from(leads).where(eq(leads.cnpj, cnpj)).limit(1);
    if (dup && dup.id !== id) throw new HttpError(409, 'CNPJ já cadastrado');
    patch.cnpj = cnpj;
  }

  if (rest.phone !== undefined) {
    if (current!.phone && current!.phone.length > 0) {
      throw new HttpError(400, 'Phone cannot be edited');
    }
    const phone = normalizePhone(rest.phone);
    if (phone.length < 8) throw new HttpError(400, 'Phone must have at least 8 digits');
    patch.phone = phone;
    // Promove o stage de incomplete → complete quando phone é adicionado.
    if (current!.flowStage === 'incomplete') {
      patch.flowStage = 'complete';
    }
  }

  try {
    const [row] = await db.update(leads).set(patch).where(eq(leads.id, id)).returning();
    if (!row) throw new HttpError(404, 'Lead not found');
    // Audit trail: registra mudança de stage se ocorreu (current?.flowStage carregado acima).
    if (current && current.flowStage !== row.flowStage) {
      await recordTransition({
        leadId: row.id,
        fromStage: current.flowStage as LeadFlowStage,
        toStage: row.flowStage,
        source: 'manual_update',
      });
    }
    // Se o phone foi adicionado agora, lead transicionou pra 'complete' →
    // enrola na campanha contínua.
    if (rest.phone !== undefined && row.flowStage === 'complete') {
      await tryEnrollSafe(row.id);
    }
    return toPublic({ ...row, hasDeal: false });
  } catch (err) {
    const pgErr = ((err as { cause?: unknown })?.cause ?? err) as { code?: string; constraint?: string };
    if (pgErr?.code === '23505' && (pgErr.constraint === undefined || pgErr.constraint.includes('cnpj'))) {
      throw new HttpError(409, 'CNPJ já cadastrado');
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// getLeadById — usado pelo modal de edição inline (whatsapp inbox, deal drawer)
// ---------------------------------------------------------------------------

export async function getLeadById(id: string): Promise<PublicLead> {
  const [row] = await db
    .select({
      lead: leads,
      hasDeal: sql<boolean>`EXISTS (SELECT 1 FROM deals d WHERE d.lead_id = ${leads.id})`,
    })
    .from(leads)
    .where(eq(leads.id, id))
    .limit(1);
  if (!row) throw new HttpError(404, 'Lead not found');
  return toPublic({ ...row.lead, hasDeal: Boolean(row.hasDeal) });
}

// ---------------------------------------------------------------------------
// markLost — admin marca lead como perdido manualmente
// ---------------------------------------------------------------------------

export async function markLeadLost(input: {
  id: string;
  reason?: string | null;
}): Promise<PublicLead> {
  const [current] = await db
    .select({ flowStage: leads.flowStage })
    .from(leads)
    .where(eq(leads.id, input.id))
    .limit(1);
  if (!current) throw new HttpError(404, 'Lead not found');
  if (current.flowStage === 'lost') throw new HttpError(400, 'Lead já está marcado como perdido');
  if (current.flowStage === 'handed_off') {
    throw new HttpError(400, 'Lead já foi pro comercial — feche o deal pra marcar como perdido');
  }

  const [row] = await db
    .update(leads)
    .set({ flowStage: 'lost', updatedAt: new Date() })
    .where(eq(leads.id, input.id))
    .returning();
  if (!row) throw new HttpError(404, 'Lead not found');

  await recordTransition({
    leadId: input.id,
    fromStage: current.flowStage as PublicLead['flowStage'],
    toStage: 'lost',
    source: 'manual_lost',
    metadata: input.reason ? { reason: input.reason } : undefined,
  });

  return toPublic({ ...row, hasDeal: false });
}

// ---------------------------------------------------------------------------
// deleteLead
// ---------------------------------------------------------------------------

export async function deleteLead(id: string): Promise<void> {
  const [row] = await db.delete(leads).where(eq(leads.id, id)).returning({ id: leads.id });
  if (!row) throw new HttpError(404, 'Lead not found');
}

// ---------------------------------------------------------------------------
// listLeads
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;
type SortKey = 'name' | 'created_at';
const SORT_COLUMNS: Record<SortKey, AnyColumn> = {
  name: leads.name,
  created_at: leads.createdAt,
};

// Subquery que pega o result_status do enriquecimento MAIS RECENTE pra cada
// lead. Usada tanto no SELECT (pra mostrar badge na tabela) quanto no WHERE
// (filtro "com problemas"). Reuso evita codigo duplicado.
const LATEST_ENRICHMENT_RESULT_SQL = sql<string | null>`(
  SELECT ejl.result_status FROM enrichment_job_leads ejl
  WHERE ejl.lead_id = ${leads.id}
    AND ejl.processed_at IS NOT NULL
  ORDER BY ejl.processed_at DESC
  LIMIT 1
)`;

// Issues: estados problematicos que o usuario quer revisar.
// phone_found NAO eh issue. phone_not_in_brasilapi e api_error sao "soft"
// (lead ainda util), mas vale mostrar.
const ISSUE_STATUSES = ['cnpj_inactive', 'cnpj_not_found', 'phone_not_in_brasilapi', 'api_error'] as const;

export async function listLeads(params: {
  q?: string;
  status?: LeadStatus;
  source?: LeadSource;
  flowStage?: LeadFlowStage;
  pipeline?: 'yes' | 'no';
  withIssues?: boolean;
  sort?: SortKey;
  order?: 'asc' | 'desc';
  page?: number;
}): Promise<{ items: PublicLead[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, params.page ?? 1);
  const sortKey: SortKey = params.sort ?? 'created_at';
  const orderFn = params.order === 'asc' ? asc : desc;
  const sortCol = SORT_COLUMNS[sortKey];

  const conditions = [];
  if (params.status) conditions.push(eq(leads.status, params.status));
  if (params.source) conditions.push(eq(leads.source, params.source));
  if (params.flowStage) conditions.push(eq(leads.flowStage, params.flowStage));
  if (params.pipeline === 'yes') {
    conditions.push(sql`EXISTS (SELECT 1 FROM deals d WHERE d.lead_id = ${leads.id})`);
  }
  if (params.pipeline === 'no') {
    conditions.push(sql`NOT EXISTS (SELECT 1 FROM deals d WHERE d.lead_id = ${leads.id})`);
  }
  if (params.withIssues) {
    // Filtra leads cujo enriquecimento mais recente foi um dos status problematicos.
    const issuesArr = ISSUE_STATUSES.map((s) => `'${s}'`).join(',');
    conditions.push(sql`(${LATEST_ENRICHMENT_RESULT_SQL}) IN (${sql.raw(issuesArr)})`);
  }
  if (params.q) {
    const escaped = params.q.replace(/[%_\\]/g, '\\$&');
    const pat = `%${escaped}%`;
    const searchExpr = or(
      ilike(leads.name, pat),
      ilike(leads.phone, pat),
      ilike(leads.cnpj, pat),
    );
    if (searchExpr) conditions.push(searchExpr);
  }
  const where = conditions.length ? and(...conditions) : undefined;

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(leads)
    .where(where);

  const rows = await db
    .select({
      lead: leads,
      hasDeal: sql<boolean>`EXISTS (SELECT 1 FROM deals d WHERE d.lead_id = ${leads.id})`,
      lastEnrichmentResult: LATEST_ENRICHMENT_RESULT_SQL,
    })
    .from(leads)
    .where(where)
    .orderBy(orderFn(sortCol))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  return {
    items: rows.map((r) => toPublic({
      ...r.lead,
      hasDeal: Boolean(r.hasDeal),
      lastEnrichmentResult: r.lastEnrichmentResult,
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
  };
}

/**
 * Encerra um lead sem criar deal. Captura feedback de calibração da IA.
 * Lead vai pra flowStage='lost'. Idempotente: se já lost, atualiza campos.
 */
export async function closeLeadNoDeal(input: {
  leadId: string;
  actorUserId: string;
  reason: string;
  quality: LeadQualityFeedback;
}): Promise<void> {
  // Rejeita se já existe deal — caminho errado, deveria ter usado changeStage.
  const [existingDeal] = await db.select().from(deals).where(eq(deals.leadId, input.leadId)).limit(1);
  if (existingDeal) {
    throw new HttpError(400, 'Lead already has a deal — use deal stage change instead');
  }

  // Captura flowStage atual pra audit trail (passar null perde rastreabilidade).
  const [lead] = await db
    .select({ flowStage: leads.flowStage })
    .from(leads)
    .where(eq(leads.id, input.leadId))
    .limit(1);
  if (!lead) throw new HttpError(404, 'Lead not found');

  // Idempotência: se já está lost, atualiza campos mas não duplica audit.
  const wasAlreadyLost = lead.flowStage === 'lost';

  await db.update(leads).set({
    flowStage: 'lost',
    closedNoDealAt: new Date(),
    closedNoDealBy: input.actorUserId,
    closedNoDealReason: input.reason,
    closedNoDealQuality: input.quality,
    updatedAt: new Date(),
  }).where(eq(leads.id, input.leadId));

  // Audit trail — só registra transição se houve mudança de stage.
  if (!wasAlreadyLost) {
    await recordTransition({
      leadId: input.leadId,
      fromStage: lead.flowStage,
      toStage: 'lost',
      source: 'manual_lost',
      metadata: { reason: input.reason, quality: input.quality, by: input.actorUserId },
    });
  }
}
