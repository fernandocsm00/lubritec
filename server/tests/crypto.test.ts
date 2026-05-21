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
    const [, ivB64, tagB64, ctB64] = enc.split(':');
    const ctBuf = Buffer.from(ctB64, 'base64');
    // Flip the last byte
    ctBuf[ctBuf.length - 1] = ctBuf[ctBuf.length - 1] ^ 0xff;
    const bad = `enc:${ivB64}:${tagB64}:${ctBuf.toString('base64')}`;
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

  it('_resetKeyCache forces re-read of WHATSAPP_CREDENTIALS_KEY', async () => {
    // Import dynamically to also get the reset helper
    const { encryptSecret: enc, decryptSecret: dec, _resetKeyCache } = await import('../lib/crypto');

    // Encrypt with current key
    const ct1 = enc('payload');
    expect(dec(ct1)).toBe('payload');

    // Swap key and reset cache
    const newKey = randomBytes(32).toString('hex');
    process.env.WHATSAPP_CREDENTIALS_KEY = newKey;
    _resetKeyCache();

    // Old ciphertext must NOT decrypt under new key (auth tag fails)
    expect(() => dec(ct1)).toThrow();

    // But round-trip with the new key works
    const ct2 = enc('payload');
    expect(dec(ct2)).toBe('payload');
  });
});
