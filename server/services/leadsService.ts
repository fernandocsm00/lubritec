import { db } from '../db/client';
import { leads } from '../db/schema';
import { eq } from 'drizzle-orm';
import { HttpError } from '../middleware/errorHandler';
import type { PublicLead, LeadStatus } from '@shared/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, '');
}

function toPublic(row: typeof leads.$inferSelect): PublicLead {
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
  return toPublic(row);
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
  status?: LeadStatus;
}): Promise<PublicLead> {
  const { id, ...rest } = input;
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) {
    if (v !== undefined) patch[k] = v;
  }
  patch.updatedAt = new Date();
  const [row] = await db.update(leads).set(patch).where(eq(leads.id, id)).returning();
  if (!row) throw new HttpError(404, 'Lead not found');
  return toPublic(row);
}

// ---------------------------------------------------------------------------
// deleteLead
// ---------------------------------------------------------------------------

export async function deleteLead(id: string): Promise<void> {
  const [row] = await db.delete(leads).where(eq(leads.id, id)).returning({ id: leads.id });
  if (!row) throw new HttpError(404, 'Lead not found');
}
