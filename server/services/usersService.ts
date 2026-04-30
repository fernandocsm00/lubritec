import { db } from '../db/client';
import { users, authTokens } from '../db/schema';
import { eq, sql, asc } from 'drizzle-orm';
import { generateRawToken, hashToken } from '../lib/tokens';
import { HttpError } from '../middleware/errorHandler';
import type { Role } from '@shared/types';

const INVITE_TTL_DAYS = Number(process.env.INVITE_TTL_DAYS || 7);

export async function inviteUser(input: { email: string; name: string; role: Role }) {
  const [existing] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
  if (existing) {
    throw new HttpError(409, 'Email already in use');
  }
  const [user] = await db
    .insert(users)
    .values({
      email: input.email,
      name: input.name,
      role: input.role,
      passwordHash: null,
    })
    .returning();

  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
  const [t] = await db
    .insert(authTokens)
    .values({
      userId: user.id,
      tokenHash,
      purpose: 'invite',
      expiresAt,
    })
    .returning();

  return { tokenId: t.id, rawToken, user };
}

export async function listUsers() {
  const rows = await db
    .select()
    .from(users)
    .orderBy(sql`${users.role} = 'admin' DESC`, asc(users.name));
  return rows.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    is_active: u.isActive,
    last_login_at: u.lastLoginAt?.toISOString() ?? null,
    created_at: u.createdAt.toISOString(),
    has_password: u.passwordHash !== null,
  }));
}
