import jwt from 'jsonwebtoken';
import type { Role } from '@shared/types';

const SECRET = process.env.JWT_SECRET!;
const TTL = process.env.JWT_ACCESS_TTL || '15m';

if (!SECRET) {
  throw new Error('JWT_SECRET not set');
}

const TTL_RE = /^\d+(ms|s|m|h|d|w|y)?$/;
if (!TTL_RE.test(TTL)) {
  throw new Error(`JWT_ACCESS_TTL must be a number-of-seconds or ms-style duration (e.g. "15m"); got "${TTL}"`);
}

export interface AccessTokenPayload {
  userId: string;
  role: Role;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: TTL } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, SECRET, { algorithms: ['HS256'] }) as AccessTokenPayload & { iat?: number; exp?: number };
  return { userId: decoded.userId, role: decoded.role };
}
