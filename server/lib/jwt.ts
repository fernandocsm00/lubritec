import jwt from 'jsonwebtoken';
import type { Role } from '@shared/types';

const SECRET = process.env.JWT_SECRET!;
const TTL = process.env.JWT_ACCESS_TTL || '15m';

if (!SECRET) {
  throw new Error('JWT_SECRET not set');
}

export interface AccessTokenPayload {
  userId: string;
  role: Role;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: TTL } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, SECRET) as AccessTokenPayload & { iat?: number; exp?: number };
  return { userId: decoded.userId, role: decoded.role };
}
