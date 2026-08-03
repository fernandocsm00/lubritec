import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocka o client de baixo nível pra capturar a config que o provider repassa.
vi.mock('../services/whatsapp/uazapi/client', () => ({
  sendUazapiMessage: vi.fn(async () => ({ messageId: 'mid-1', rawPayload: {} })),
  UazapiError: class UazapiError extends Error {},
}));

import { sendUazapiMessage } from '../services/whatsapp/uazapi/client';
import { UazapiProvider } from '../services/whatsapp/uazapi/provider';

const cfg = {
  baseUrl: 'https://oriondigital.uazapi.com',
  instanceId: 'r842bde0e9e6b91',
  // token em texto puro: decryptSecret faz passthrough sem a chave de cripto.
  instanceToken: 'plain-token-fixo',
  webhookSecret: null,
  webhookUrl: null,
  webhookSynced: false,
};

beforeEach(() => {
  vi.mocked(sendUazapiMessage).mockClear();
});

describe('UazapiProvider — envio usa a config DA INSTÂNCIA (não a padrão)', () => {
  it('sendText repassa baseUrl + token decriptado da própria instância', async () => {
    const provider = new UazapiProvider('inst-fixo', cfg);
    await provider.sendText({ to: '5511999998888', text: 'oi' });

    expect(sendUazapiMessage).toHaveBeenCalledTimes(1);
    const [opts, passedCfg] = vi.mocked(sendUazapiMessage).mock.calls[0];
    expect(opts).toMatchObject({ to: '5511999998888', kind: 'text', text: 'oi' });
    expect(passedCfg).toEqual({
      baseUrl: 'https://oriondigital.uazapi.com',
      token: 'plain-token-fixo',
    });
  });

  it('sendMedia também repassa a config da instância', async () => {
    const provider = new UazapiProvider('inst-fixo', cfg);
    await provider.sendMedia({
      to: '5511999998888', kind: 'image',
      mediaUrl: 'https://x/y.jpg', mediaMime: 'image/jpeg', caption: 'foto',
    });

    const [, passedCfg] = vi.mocked(sendUazapiMessage).mock.calls[0];
    expect(passedCfg).toEqual({
      baseUrl: 'https://oriondigital.uazapi.com',
      token: 'plain-token-fixo',
    });
  });
});
