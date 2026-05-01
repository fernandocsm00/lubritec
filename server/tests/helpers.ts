import { db } from '../db/client';
import { users, leads } from '../db/schema';
import { hashPassword } from '../lib/hash';
import type { Role, LeadStatus, LeadSource } from '@shared/types';

export async function createUser(opts: {
  email?: string;
  name?: string;
  password?: string;
  role?: Role;
  isActive?: boolean;
}) {
  const passwordHash = opts.password ? await hashPassword(opts.password) : null;
  const [u] = await db
    .insert(users)
    .values({
      email: opts.email ?? `user-${Date.now()}@test.com`,
      name: opts.name ?? 'Test User',
      role: opts.role ?? 'comercial',
      isActive: opts.isActive ?? true,
      passwordHash,
    })
    .returning();
  return u;
}

export async function createLead(opts: {
  name?: string;
  phone?: string;
  email?: string | null;
  notes?: string | null;
  vehiclePlate?: string | null;
  vehicleModel?: string | null;
  lastPurchaseDate?: string | null;
  avgMileagePerDay?: number | null;
  status?: LeadStatus;
  source?: LeadSource;
}) {
  const [l] = await db
    .insert(leads)
    .values({
      name: opts.name ?? 'Lead Test',
      phone: opts.phone ?? `${Date.now()}${Math.floor(Math.random() * 1000)}`,
      email: opts.email ?? null,
      notes: opts.notes ?? null,
      vehiclePlate: opts.vehiclePlate ?? null,
      vehicleModel: opts.vehicleModel ?? null,
      lastPurchaseDate: opts.lastPurchaseDate ?? null,
      avgMileagePerDay: opts.avgMileagePerDay ?? null,
      status: opts.status ?? 'frio',
      source: opts.source ?? 'manual',
    })
    .returning();
  return l;
}
