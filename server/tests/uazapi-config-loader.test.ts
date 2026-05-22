import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/client';
import { whatsappInstance } from '../db/schema';
import { createWhatsappInstance } from './helpers';
import { loadSendConfig, loadWebhookSecret } from '../services/whatsappInstanceService';
import { encryptSecret } from '../lib/crypto';

beforeEach(() => {
  delete process.env.UAZAPI_BASE_URL;
  delete process.env.UAZAPI_TOKEN;
  delete process.env.UAZAPI_ADMIN_TOKEN;
  delete process.env.UAZAPI_INSTANCE_ID;
  delete process.env.UAZAPI_WEBHOOK_SECRET;
});

describe('loadSendConfig', () => {
  it('lança 503 quando DB vazio e env incompleto', async () => {
    await expect(loadSendConfig()).rejects.toThrow();
  });

  it('lê do DB quando row existe com instanceId+token', async () => {
    await createWhatsappInstance({
      isDefault: true,
      providerConfig: {
        baseUrl: 'https://x.api',
        instanceId: 'i',
        instanceToken: encryptSecret('t'),
        webhookSecret: null,
        webhookUrl: null,
        webhookSynced: false,
      },
    });
    const cfg = await loadSendConfig();
    expect(cfg.baseUrl).toBe('https://x.api');
    expect(cfg.instanceId).toBe('i');
    expect(cfg.token).toBe('t');
  });

  it('faz seed automático quando DB vazio mas env completo', async () => {
    process.env.UAZAPI_BASE_URL = 'https://api.uazapi.com';
    process.env.UAZAPI_TOKEN = 'env-token';
    process.env.UAZAPI_INSTANCE_ID = 'env-instance';
    process.env.UAZAPI_WEBHOOK_SECRET = 'env-secret';

    const cfg = await loadSendConfig();
    expect(cfg.instanceId).toBe('env-instance');
    expect(cfg.token).toBe('env-token');

    // Confirma que row foi criada
    const [row] = await db.select().from(whatsappInstance);
    expect(row).toBeDefined();
    const provCfg = row.providerConfig as Record<string, unknown>;
    expect(provCfg.webhookSynced).toBe(true);
  });
});

describe('loadWebhookSecret', () => {
  it('retorna null quando DB vazio e env vazio', async () => {
    const s = await loadWebhookSecret();
    expect(s).toBeNull();
  });

  it('lê do DB quando preenchido', async () => {
    await createWhatsappInstance({
      isDefault: true,
      providerConfig: {
        baseUrl: 'https://api.uazapi.com',
        instanceId: null,
        instanceToken: null,
        webhookSecret: encryptSecret('db-secret'),
        webhookUrl: null,
        webhookSynced: false,
      },
    });
    const s = await loadWebhookSecret();
    expect(s).toBe('db-secret');
  });

  it('fallback pra env quando DB vazio mas env preenchido', async () => {
    process.env.UAZAPI_WEBHOOK_SECRET = 'env-secret';
    const s = await loadWebhookSecret();
    expect(s).toBe('env-secret');
  });

  it('DB tem precedência sobre env', async () => {
    process.env.UAZAPI_WEBHOOK_SECRET = 'env-secret';
    await createWhatsappInstance({
      isDefault: true,
      providerConfig: {
        baseUrl: 'https://api.uazapi.com',
        instanceId: null,
        instanceToken: null,
        webhookSecret: encryptSecret('db-secret'),
        webhookUrl: null,
        webhookSynced: false,
      },
    });
    const s = await loadWebhookSecret();
    expect(s).toBe('db-secret');
  });
});
