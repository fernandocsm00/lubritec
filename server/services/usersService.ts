import { db } from '../db/client';
import { users, authTokens, sessions } from '../db/schema';
import { eq, and, sql, asc } from 'drizzle-orm';
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

export async function resendInvite(userId: string) {
  return db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) {
      throw new HttpError(404, 'User not found');
    }
    if (user.passwordHash !== null) {
      throw new HttpError(409, 'User already activated');
    }
    await tx
      .delete(authTokens)
      .where(and(eq(authTokens.userId, userId), eq(authTokens.purpose, 'invite')));
    const rawToken = generateRawToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
    const [t] = await tx
      .insert(authTokens)
      .values({
        userId: user.id,
        tokenHash,
        purpose: 'invite',
        expiresAt,
      })
      .returning();
    return { user, tokenId: t.id, rawToken };
  });
}

export async function updateUser(input: {
  id: string;
  actorId: string;
  name?: string;
  role?: Role;
  is_active?: boolean;
}) {
  const isSelf = input.id === input.actorId;
  const touchesProtected = input.role !== undefined || input.is_active !== undefined;
  if (isSelf && touchesProtected) {
    throw new HttpError(409, 'Cannot modify your own role or status');
  }

  const result = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(users).where(eq(users.id, input.id)).limit(1);
    if (!existing) {
      throw new HttpError(404, 'User not found');
    }
    const patch: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
    if (input.name !== undefined) patch.name = input.name;
    if (input.role !== undefined) patch.role = input.role;
    if (input.is_active !== undefined) patch.isActive = input.is_active;
    const [updated] = await tx
      .update(users)
      .set(patch)
      .where(eq(users.id, input.id))
      .returning();

    const shouldRevoke =
      (input.role !== undefined && input.role !== existing.role) ||
      (input.is_active !== undefined && input.is_active !== existing.isActive);
    if (shouldRevoke) {
      await tx
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(eq(sessions.userId, input.id));
    }
    return updated;
  });

  return {
    id: result.id,
    email: result.email,
    name: result.name,
    role: result.role,
    is_active: result.isActive,
    last_login_at: result.lastLoginAt?.toISOString() ?? null,
    created_at: result.createdAt.toISOString(),
    has_password: result.passwordHash !== null,
  };
}
