import { db } from '../db/client';
import { users, sessions, authTokens } from '../db/schema';
import { eq, and, isNull, gt } from 'drizzle-orm';
import { verifyPassword, hashPassword } from '../lib/hash';
import { signAccessToken } from '../lib/jwt';
import { generateRawToken, hashToken, isExpired } from '../lib/tokens';
import { HttpError } from '../middleware/errorHandler';
import type { PublicUser } from '@shared/types';

const REFRESH_TTL_DAYS = Number(process.env.JWT_REFRESH_TTL_DAYS || 30);
const RESET_TTL_HOURS = Number(process.env.RESET_TTL_HOURS || 1);

function toPublic(u: typeof users.$inferSelect): PublicUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    isActive: u.isActive,
    createdAt: u.createdAt.toISOString(),
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
  };
}

export async function login(input: {
  email: string;
  password: string;
  userAgent: string;
  ip: string;
}) {
  const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
  if (!user || !user.isActive || !user.passwordHash) {
    throw new HttpError(401, 'Invalid credentials');
  }
  const ok = await verifyPassword(input.password, user.passwordHash);
  if (!ok) {
    throw new HttpError(401, 'Invalid credentials');
  }

  const refreshToken = generateRawToken();
  const refreshHash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(sessions).values({
    userId: user.id,
    refreshTokenHash: refreshHash,
    userAgent: input.userAgent,
    ipAddress: input.ip || null,
    expiresAt,
  });

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

  const accessToken = signAccessToken({ userId: user.id, role: user.role });
  return { accessToken, refreshToken, user: toPublic(user) };
}

export async function refreshAccess(rawRefresh: string) {
  const hash = hashToken(rawRefresh);
  const [session] = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.refreshTokenHash, hash),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!session) {
    throw new HttpError(401, 'Invalid refresh token');
  }
  const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  if (!user || !user.isActive) {
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.id, session.id));
    throw new HttpError(401, 'User no longer valid');
  }
  const accessToken = signAccessToken({ userId: user.id, role: user.role });
  return { accessToken, user: toPublic(user) };
}

export async function logout(rawRefresh: string) {
  const hash = hashToken(rawRefresh);
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(eq(sessions.refreshTokenHash, hash));
}

export async function getMe(userId: string): Promise<PublicUser> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new HttpError(404, 'User not found');
  return toPublic(user);
}

async function consumeToken(tokenId: string, rawToken: string, expectedPurpose: 'invite' | 'password_reset') {
  const [t] = await db.select().from(authTokens).where(eq(authTokens.id, tokenId)).limit(1);
  if (!t || t.purpose !== expectedPurpose) {
    throw new HttpError(400, 'Invalid token');
  }
  if (t.usedAt) throw new HttpError(400, 'Token already used');
  if (isExpired(t.expiresAt)) throw new HttpError(400, 'Token expired');
  if (hashToken(rawToken) !== t.tokenHash) throw new HttpError(400, 'Invalid token');
  await db.update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.id, tokenId));
  return t.userId;
}

export async function setupPassword(input: {
  tokenId: string;
  rawToken: string;
  password: string;
  userAgent: string;
  ip: string;
}) {
  const userId = await consumeToken(input.tokenId, input.rawToken, 'invite');
  const passwordHash = await hashPassword(input.password);
  await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, userId));
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return doLoginForUser(user, input.userAgent, input.ip);
}

export async function requestReset(email: string): Promise<{ tokenId: string; rawToken: string; userName: string } | null> {
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || !user.isActive) return null;
  const rawToken = generateRawToken();
  const expiresAt = new Date(Date.now() + RESET_TTL_HOURS * 60 * 60 * 1000);
  const [t] = await db
    .insert(authTokens)
    .values({
      userId: user.id,
      tokenHash: hashToken(rawToken),
      purpose: 'password_reset',
      expiresAt,
    })
    .returning();
  return { tokenId: t.id, rawToken, userName: user.name };
}

export async function resetPassword(input: {
  tokenId: string;
  rawToken: string;
  password: string;
  userAgent: string;
  ip: string;
}) {
  const userId = await consumeToken(input.tokenId, input.rawToken, 'password_reset');
  const passwordHash = await hashPassword(input.password);
  await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, userId));
  // Revoga sessions antigas
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.userId, userId));
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return doLoginForUser(user, input.userAgent, input.ip);
}

async function doLoginForUser(user: typeof users.$inferSelect, userAgent: string, ip: string) {
  const refreshToken = generateRawToken();
  const refreshHash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({
    userId: user.id,
    refreshTokenHash: refreshHash,
    userAgent,
    ipAddress: ip || null,
    expiresAt,
  });
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  const accessToken = signAccessToken({ userId: user.id, role: user.role });
  return { accessToken, refreshToken, user: toPublic(user) };
}
