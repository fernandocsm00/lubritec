import { db } from '../db/client';
import { leads, deals, type NewLead } from '../db/schema';
import { eq, and, or, ilike, desc, asc, sql, type AnyColumn } from 'drizzle-orm';
import { HttpError } from '../middleware/errorHandler';
import type { PublicLead, LeadStatus, LeadSource } from '@shared/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, '');
}

function toPublic(row: typeof leads.$inferSelect & { hasDeal?: boolean }): PublicLead {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    notes: row.notes,
    vehiclePlate: row.vehiclePlate,
    vehicleModel: row.vehicleModel,
    lastPurchaseDate: row.lastPurchaseDate,
    avgMileagePerDay: row.avgMileagePerDay,
    status: row.status,
    source: row.source,
    hasDeal: row.hasDeal ?? false,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// createLead
// ---------------------------------------------------------------------------

export async function createLead(input: {
  name: string;
  phone: string;
  email?: string | null;
  notes?: string | null;
  vehiclePlate?: string | null;
  vehicleModel?: string | null;
  lastPurchaseDate?: string | null;
  avgMileagePerDay?: number | null;
}): Promise<PublicLead> {
  const phone = normalizePhone(input.phone);
  if (phone.length < 8) throw new HttpError(400, 'Phone must have at least 8 digits');
  // Best-effort guard — the unique index on phone is the authoritative constraint
  const [existing] = await db.select().from(leads).where(eq(leads.phone, phone)).limit(1);
  if (existing) throw new HttpError(409, 'Phone already in use');
  // Race fix: if two requests pass the pre-check concurrently, the second insert
  // trips the unique constraint on phone (leads_phone_key). Translate the pg
  // unique_violation (23505) to the same 409 the pre-check would have thrown,
  // so the client never sees a 500 for this case.
  try {
    const [row] = await db
      .insert(leads)
      .values({
        name: input.name,
        phone,
        email: input.email ?? null,
        notes: input.notes ?? null,
        vehiclePlate: input.vehiclePlate ?? null,
        vehicleModel: input.vehicleModel ?? null,
        lastPurchaseDate: input.lastPurchaseDate ?? null,
        avgMileagePerDay: input.avgMileagePerDay ?? null,
      })
      .returning();
    return toPublic({ ...row, hasDeal: false });
  } catch (err) {
    // Drizzle wraps the underlying pg error in a DrizzleQueryError; the original
    // pg error is available as `err.cause`. Check both levels for safety.
    const pgErr = (
      (err as { cause?: unknown })?.cause ?? err
    ) as { code?: string; constraint?: string };
    // Only convert to 409 when it's specifically the phone unique-violation;
    // the constraint is named leads_phone_key (migration 007).
    if (
      pgErr?.code === '23505' &&
      (pgErr.constraint === undefined || pgErr.constraint.includes('phone'))
    ) {
      throw new HttpError(409, 'Phone already in use');
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
  vehiclePlate?: string | null;
  vehicleModel?: string | null;
  lastPurchaseDate?: string | null;
  avgMileagePerDay?: number | null;
  // source is intentionally immutable after creation
  status?: LeadStatus;
}): Promise<PublicLead> {
  const { id, ...rest } = input;
  // updatedAt is always refreshed, even for no-op patches, to signal "touched"
  const patch: Partial<NewLead> = { updatedAt: new Date() };
  if (rest.name !== undefined) patch.name = rest.name;
  if (rest.email !== undefined) patch.email = rest.email;
  if (rest.notes !== undefined) patch.notes = rest.notes;
  if (rest.vehiclePlate !== undefined) patch.vehiclePlate = rest.vehiclePlate;
  if (rest.vehicleModel !== undefined) patch.vehicleModel = rest.vehicleModel;
  if (rest.lastPurchaseDate !== undefined) patch.lastPurchaseDate = rest.lastPurchaseDate;
  if (rest.avgMileagePerDay !== undefined) patch.avgMileagePerDay = rest.avgMileagePerDay;
  if (rest.status !== undefined) patch.status = rest.status;
  const [row] = await db.update(leads).set(patch).where(eq(leads.id, id)).returning();
  if (!row) throw new HttpError(404, 'Lead not found');
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
type SortKey = 'name' | 'created_at' | 'last_purchase_date';
const SORT_COLUMNS: Record<SortKey, AnyColumn> = {
  name: leads.name,
  created_at: leads.createdAt,
  last_purchase_date: leads.lastPurchaseDate,
};

export async function listLeads(params: {
  q?: string;
  status?: LeadStatus;
  source?: LeadSource;
  pipeline?: 'yes' | 'no';
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
  if (params.pipeline === 'yes') {
    conditions.push(sql`EXISTS (SELECT 1 FROM deals d WHERE d.lead_id = ${leads.id})`);
  }
  if (params.pipeline === 'no') {
    conditions.push(sql`NOT EXISTS (SELECT 1 FROM deals d WHERE d.lead_id = ${leads.id})`);
  }
  if (params.q) {
    const escaped = params.q.replace(/[%_\\]/g, '\\$&');
    const pat = `%${escaped}%`;
    const searchExpr = or(
      ilike(leads.name, pat),
      ilike(leads.phone, pat),
      ilike(leads.vehiclePlate, pat),
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
    })
    .from(leads)
    .where(where)
    .orderBy(orderFn(sortCol))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  return { items: rows.map((r) => toPublic({ ...r.lead, hasDeal: Boolean(r.hasDeal) })), total, page, pageSize: PAGE_SIZE };
}
