import { db } from '../db/client';
import { leads } from '../db/schema';
import { eq } from 'drizzle-orm';
import { HttpError } from '../middleware/errorHandler';
import type { PublicLead } from '@shared/types';

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
