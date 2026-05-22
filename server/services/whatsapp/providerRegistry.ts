import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { whatsappInstance } from '../../db/schema';
import { HttpError } from '../../middleware/errorHandler';
import type { WhatsAppProvider } from './provider';
import { UazapiProvider } from './uazapi/provider';
import { uazapiConfigSchema } from './uazapi/configSchema';
import { MetaCloudProvider } from './metaCloud/provider';
import { metaCloudConfigSchema } from './metaCloud/configSchema';

const TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  provider: WhatsAppProvider;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export async function resolveProvider(instanceId: string): Promise<WhatsAppProvider> {
  const hit = cache.get(instanceId);
  if (hit && hit.expiresAt > Date.now()) return hit.provider;

  const [row] = await db.select().from(whatsappInstance)
    .where(eq(whatsappInstance.id, instanceId)).limit(1);
  if (!row) throw new HttpError(404, 'WhatsApp instance not found');

  const provider = buildProvider(row);
  cache.set(instanceId, { provider, expiresAt: Date.now() + TTL_MS });
  return provider;
}

export async function resolveDefaultProvider(): Promise<WhatsAppProvider> {
  const [row] = await db.select().from(whatsappInstance)
    .where(eq(whatsappInstance.isDefault, true)).limit(1);
  if (!row) {
    throw new HttpError(503, 'No default WhatsApp instance configured');
  }
  return resolveProvider(row.id);
}

export function invalidateProvider(instanceId: string): void {
  cache.delete(instanceId);
}

/** Test-only: clear the cache between tests. */
export function _clearCache(): void {
  cache.clear();
}

function buildProvider(row: typeof whatsappInstance.$inferSelect): WhatsAppProvider {
  switch (row.provider) {
    case 'uazapi': {
      const cfg = uazapiConfigSchema.parse(row.providerConfig);
      return new UazapiProvider(row.id, cfg);
    }
    case 'meta_cloud': {
      const cfg = metaCloudConfigSchema.parse(row.providerConfig);
      return new MetaCloudProvider(row.id, cfg);
    }
    default:
      throw new HttpError(500, `Unsupported provider kind: ${(row as any).provider}`);
  }
}
