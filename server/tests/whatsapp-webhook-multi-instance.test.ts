import { describe, it, expect, beforeEach } from 'vitest';
import { createWhatsappInstance } from './helpers';
import {
  loadValidWebhookTokens,
  resolveInstanceIdByWebhookToken,
} from '../services/whatsappInstanceService';

// Tokens em texto puro de propósito: decryptSecret faz passthrough de valores
// sem prefixo "enc:", então os testes não precisam da WHATSAPP_CREDENTIALS_KEY.
function uazCfg(instanceId: string, token: string, baseUrl = 'https://oriondigital.uazapi.com') {
  return {
    baseUrl,
    instanceId,
    instanceToken: token,
    webhookSecret: null,
    webhookUrl: null,
    webhookSynced: false,
  };
}

beforeEach(() => {
  delete process.env.UAZAPI_WEBHOOK_SECRET;
});

describe('loadValidWebhookTokens (multi-instância)', () => {
  it('inclui tokens de TODAS as linhas UazAPI ativas, não só a padrão', async () => {
    await createWhatsappInstance({
      provider: 'uazapi', isDefault: true, displayName: 'A',
      providerConfig: uazCfg('inst-A', 'token-A'),
    });
    await createWhatsappInstance({
      provider: 'uazapi', isDefault: false, displayName: 'B',
      providerConfig: uazCfg('inst-B', 'token-B'),
    });

    const tokens = await loadValidWebhookTokens();
    expect(tokens).toContain('token-A');
    expect(tokens).toContain('token-B');
  });

  it('NÃO lança quando a linha padrão é meta_cloud (parse UazAPI falharia)', async () => {
    await createWhatsappInstance({
      provider: 'meta_cloud', isDefault: true, displayName: 'Meta',
      providerConfig: { wabaId: 'w', phoneNumberId: 'p', accessToken: 'enc:x', appSecret: 'enc:y', webhookVerifyToken: 'v', webhookSubscribed: true },
    });
    const uaz = await createWhatsappInstance({
      provider: 'uazapi', isDefault: false, displayName: 'Fixo',
      providerConfig: uazCfg('inst-fixo', 'token-fixo'),
    });

    const tokens = await loadValidWebhookTokens();
    expect(tokens).toContain('token-fixo');
    expect(uaz.id).toBeDefined();
  });

  it('ignora linhas UazAPI arquivadas', async () => {
    await createWhatsappInstance({
      provider: 'uazapi', isDefault: true, displayName: 'Ativa',
      providerConfig: uazCfg('inst-ativa', 'token-ativa'),
    });
    await createWhatsappInstance({
      provider: 'uazapi', isArchived: true, displayName: 'Velha',
      providerConfig: uazCfg('inst-velha', 'token-velha'),
    });

    const tokens = await loadValidWebhookTokens();
    expect(tokens).toContain('token-ativa');
    expect(tokens).not.toContain('token-velha');
  });
});

describe('resolveInstanceIdByWebhookToken', () => {
  it('mapeia o token pra instância dona', async () => {
    const a = await createWhatsappInstance({
      provider: 'uazapi', isDefault: true, displayName: 'A',
      providerConfig: uazCfg('inst-A', 'token-A'),
    });
    const b = await createWhatsappInstance({
      provider: 'uazapi', isDefault: false, displayName: 'B',
      providerConfig: uazCfg('inst-B', 'token-B'),
    });

    expect(await resolveInstanceIdByWebhookToken('token-A')).toBe(a.id);
    expect(await resolveInstanceIdByWebhookToken('token-B')).toBe(b.id);
  });

  it('retorna null pra token desconhecido', async () => {
    await createWhatsappInstance({
      provider: 'uazapi', isDefault: true, displayName: 'A',
      providerConfig: uazCfg('inst-A', 'token-A'),
    });
    expect(await resolveInstanceIdByWebhookToken('nao-existe')).toBeNull();
  });
});
