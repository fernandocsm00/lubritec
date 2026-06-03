import { db } from '../db/client';
import { users, authTokens, sessions } from '../db/schema';
import { eq, and, sql, asc, inArray } from 'drizzle-orm';
import { generateRawToken, hashToken } from '../lib/tokens';
import { HttpError } from '../middleware/errorHandler';
import type { Role } from '@shared/types';

const INVITE_TTL_DAYS = Number(process.env.INVITE_TTL_DAYS || 7);

export async function inviteUser(input: { email: string; name: string; role: Role }) {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);
    if (existing) {
      throw new HttpError(409, 'Email already in use');
    }
    const [user] = await tx
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
    const [t] = await tx
      .insert(authTokens)
      .values({
        userId: user.id,
        tokenHash,
        purpose: 'invite',
        expiresAt,
      })
      .returning();

    return { tokenId: t.id, rawToken, user };
  });
}

/**
 * Compensating delete used when an invite is created in the DB but the
 * subsequent email send fails — avoids leaving a "ghost" user with no
 * password hash that nothing can clean up. CASCADE handles auth_tokens.
 */
export async function deleteUserById(userId: string): Promise<void> {
  await db.delete(users).where(eq(users.id, userId));
}

/**
 * Compensating delete for the resend-invite flow: the user already existed,
 * but the most recently issued invite token must be removed when the email
 * send fails so the next resend attempt works cleanly.
 */
export async function deleteInviteTokenById(tokenId: string): Promise<void> {
  await db.delete(authTokens).where(eq(authTokens.id, tokenId));
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
    phone: u.phone ?? null,
    last_login_at: u.lastLoginAt?.toISOString() ?? null,
    created_at: u.createdAt.toISOString(),
    has_password: u.passwordHash !== null,
  }));
}

export async function listAssignableUsers() {
  const rows = await db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(and(eq(users.isActive, true), inArray(users.role, ['admin', 'comercial'])))
    .orderBy(asc(users.name));
  return rows;
}

/**
 * Lista usuarios elegiveis pra atribuicao de CONVERSAS (inbox).
 * Inclui recepcao alem de admin/comercial — conversas de qualquer fila podem
 * ser atribuidas a qualquer atendente ativo (gerente passando pra alguem).
 *
 * listAssignableUsers (sem recepcao) continua sendo usada por deals/kanban,
 * que sao escopo comercial.
 */
export async function listConversationAssignees() {
  const rows = await db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(and(eq(users.isActive, true), inArray(users.role, ['admin', 'comercial', 'recepcao'])))
    .orderBy(asc(users.name));
  return rows;
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
  phone?: string | null;
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
    if (input.phone !== undefined) patch.phone = input.phone;
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
    phone: result.phone ?? null,
    last_login_at: result.lastLoginAt?.toISOString() ?? null,
    created_at: result.createdAt.toISOString(),
    has_password: result.passwordHash !== null,
  };
}
