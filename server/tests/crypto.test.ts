import { describe, it, expect, beforeAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encryptSecret, decryptSecret, isEncrypted } from '../lib/crypto';

beforeAll(() => {
  process.env.WHATSAPP_CREDENTIALS_KEY = randomBytes(32).toString('hex');
});

describe('crypto', () => {
  it('round-trips an ASCII secret', () => {
    const enc = encryptSecret('hello-token-123');
    expect(enc).toMatch(/^enc:/);
    expect(isEncrypted(enc)).toBe(true);
    expect(decryptSecret(enc)).toBe('hello-token-123');
  });

  it('round-trips a unicode secret', () => {
    const enc = encryptSecret('açúcar 🍯');
    expect(decryptSecret(enc)).toBe('açúcar 🍯');
  });

  it('produces different ciphertexts for the same input (random IV)', () => {
    const a = encryptSecret('same');
    const b = encryptSecret('same');
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe('same');
    expect(decryptSecret(b)).toBe('same');
  });

  it('rejects tampered ciphertext', () => {
    const enc = encryptSecret('original');
    const parts = enc.split(':');
    const tampered = parts[3] === 'A' ? 'B' + parts[3].slice(1) : 'A' + parts[3].slice(1);
    const bad = `${parts[0]}:${parts[1]}:${parts[2]}:${tampered}`;
    expect(() => decryptSecret(bad)).toThrow();
  });

  it('isEncrypted returns false for plain string', () => {
    expect(isEncrypted('plain-token')).toBe(false);
    expect(isEncrypted('')).toBe(false);
    expect(isEncrypted(null as unknown as string)).toBe(false);
  });

  it('decryptSecret returns plain value when string is not encrypted (backward-compat)', () => {
    expect(decryptSecret('plain-token')).toBe('plain-token');
  });
});
