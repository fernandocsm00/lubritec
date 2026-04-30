import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, sha256 } from '../lib/hash';

describe('hash', () => {
  it('hashes and verifies a password with argon2', async () => {
    const hash = await hashPassword('hunter2');
    expect(hash).not.toBe('hunter2');
    expect(hash.length).toBeGreaterThan(20);
    expect(await verifyPassword('hunter2', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('produces stable SHA-256 hex digest', () => {
    const a = sha256('abc');
    expect(a).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256('abc')).toBe(a);
    expect(sha256('different')).not.toBe(a);
  });

  it('returns false (does not throw) for malformed hashes', async () => {
    expect(await verifyPassword('x', 'not-a-real-hash')).toBe(false);
    expect(await verifyPassword('', '')).toBe(false);
  });
});
