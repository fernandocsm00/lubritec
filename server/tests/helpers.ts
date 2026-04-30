import { db } from '../db/client';
import { users } from '../db/schema';
import { hashPassword } from '../lib/hash';
import type { Role } from '@shared/types';

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
