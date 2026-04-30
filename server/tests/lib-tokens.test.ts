import { describe, it, expect } from 'vitest';
import { generateRawToken, hashToken, isExpired } from '../lib/tokens';

describe('tokens', () => {
  it('generates a 64-char hex random token', () => {
    const t = generateRawToken();
    expect(t).toMatch(/^[a-f0-9]{64}$/);
    expect(generateRawToken()).not.toBe(t);
  });

  it('hashes deterministically', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).not.toBe(hashToken('def'));
  });

  it('isExpired returns true for past dates', () => {
    expect(isExpired(new Date(Date.now() - 1000))).toBe(true);
    expect(isExpired(new Date(Date.now() + 60_000))).toBe(false);
  });
});
