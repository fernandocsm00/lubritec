import { db } from '../db/client';
import { users, sessions } from '../db/schema';
import { eq, and, isNull, gt } from 'drizzle-orm';
import { verifyPassword } from '../lib/hash';
import { signAccessToken } from '../lib/jwt';
import { generateRawToken, hashToken, isExpired } from '../lib/tokens';
import { HttpError } from '../middleware/errorHandler';
import type { PublicUser } from '@shared/types';

const REFRESH_TTL_DAYS = Number(process.env.JWT_REFRESH_TTL_DAYS || 30);

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
