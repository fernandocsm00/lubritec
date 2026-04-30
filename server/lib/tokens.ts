import { randomBytes } from 'crypto';
import { sha256 } from './hash';

export function generateRawToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashToken(raw: string): string {
  return sha256(raw);
}

export function isExpired(date: Date): boolean {
  return date.getTime() <= Date.now();
}
