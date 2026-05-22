import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { db } from '../db/client';
import { whatsappInstance, conversations, messages, leads } from '../db/schema';
import { createWhatsappInstance } from './helpers';
import {
  resolveProvider,
  resolveDefaultProvider,
  invalidateProvider,
  _clearCache,
} from '../services/whatsapp/providerRegistry';
import { UazapiProvider } from '../services/whatsapp/uazapi/provider';
import { HttpError } from '../middleware/errorHandler';

beforeEach(async () => {
  process.env.WHATSAPP_CREDENTIALS_KEY = crypto.randomBytes(32).toString('hex');
  _clearCache();
  // Order matters for FK
  await db.delete(messages);
  await db.delete(conversations);
  await db.delete(whatsappInstance);
  await db.delete(leads);
});

describe('providerRegistry', () => {
  it('resolves UazapiProvider for a uazapi instance', async () => {
    const row = await createWhatsappInstance({ provider: 'uazapi', displayName: 'Main' });
    const p = await resolveProvider(row.id);
    expect(p).toBeInstanceOf(UazapiProvider);
    expect(p.kind).toBe('uazapi');
    expect(p.instanceId).toBe(row.id);
  });

  it('throws HttpError for unknown instanceId', async () => {
    await expect(resolveProvider(crypto.randomUUID())).rejects.toBeInstanceOf(HttpError);
  });

  it('caches the provider on second resolve (same instance)', async () => {
    const row = await createWhatsappInstance({ provider: 'uazapi' });
    const a = await resolveProvider(row.id);
    const b = await resolveProvider(row.id);
    expect(a).toBe(b);
  });

  it('invalidateProvider forces a fresh load', async () => {
    const row = await createWhatsappInstance({ provider: 'uazapi' });
    const a = await resolveProvider(row.id);
    invalidateProvider(row.id);
    const b = await resolveProvider(row.id);
    expect(a).not.toBe(b);
  });

  it('resolveDefaultProvider returns the is_default row', async () => {
    await createWhatsappInstance({ provider: 'uazapi', displayName: 'Other' });
    const def = await createWhatsappInstance({
      provider: 'uazapi', displayName: 'Default', isDefault: true,
    });
    const p = await resolveDefaultProvider();
    expect(p.instanceId).toBe(def.id);
  });

  it('resolveDefaultProvider throws if no default exists', async () => {
    await expect(resolveDefaultProvider()).rejects.toBeInstanceOf(HttpError);
  });

  it('rejects meta_cloud provider as not yet implemented', async () => {
    const row = await createWhatsappInstance({ provider: 'meta_cloud', displayName: 'Meta' });
    await expect(resolveProvider(row.id)).rejects.toThrow(/meta_cloud|not yet/i);
  });
});
