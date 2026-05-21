import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const PREFIX = 'enc:';

let cachedKey: Buffer | null = null;

function loadKey(): Buffer {
  if (cachedKey) return cachedKey;
  const hex = process.env.WHATSAPP_CREDENTIALS_KEY;
  if (!hex) {
    throw new Error(
      'WHATSAPP_CREDENTIALS_KEY env var is required (32 random bytes, hex-encoded). ' +
      'Generate with: openssl rand -hex 32',
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('WHATSAPP_CREDENTIALS_KEY must be 64 hex chars (32 bytes).');
  }
  cachedKey = Buffer.from(hex, 'hex');
  return cachedKey;
}

/** True if string was produced by encryptSecret (has the "enc:" prefix). */
export function isEncrypted(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/**
 * Encrypt a UTF-8 string. Returns "enc:<iv_b64>:<tag_b64>:<ciphertext_b64>".
 * Each call uses a fresh random IV.
 */
export function encryptSecret(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

/**
 * Decrypt a value produced by encryptSecret. If the value does NOT start with
 * "enc:" it is returned as-is (lets us migrate gradually without breaking
 * already-decrypted callers).
 */
export function decryptSecret(value: string): string {
  if (!isEncrypted(value)) return value;
  // Safe because base64 alphabet has no colons. If you ever change the
  // serialization format to one that can contain ':', switch to indexOf-based
  // parsing or the destructuring will silently break.
  const [, ivB64, tagB64, ctB64] = value.split(':');
  if (!ivB64 || !tagB64 || !ctB64) {
    throw new Error('Malformed encrypted value');
  }
  const key = loadKey();
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

/** Test-only: clear the cached key (used after rotating WHATSAPP_CREDENTIALS_KEY in tests). */
export function _resetKeyCache(): void {
  cachedKey = null;
}
