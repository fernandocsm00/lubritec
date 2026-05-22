import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'node:crypto';
import { MetaCloudProvider } from '../services/whatsapp/metaCloud/provider';
import { encryptSecret, _resetKeyCache } from '../lib/crypto';
import { ProviderError, OutOfSessionWindowError } from '../services/whatsapp/provider';

vi.mock('../services/whatsapp/metaCloud/templates', () => ({
  sendTemplateMessage: vi.fn(),
}));
vi.mock('../services/whatsapp/metaCloud/client', async () => {
  const actual = await vi.importActual<typeof import('../services/whatsapp/metaCloud/client')>(
    '../services/whatsapp/metaCloud/client'
  );
  return {
    ...actual,
    getPhoneNumberInfo: vi.fn(),
    sendText: vi.fn(),
    sendMedia: vi.fn(),
    isOutOfSessionError: vi.fn(),
  };
});
import { sendTemplateMessage } from '../services/whatsapp/metaCloud/templates';
import { isOutOfSessionError, MetaGraphError } from '../services/whatsapp/metaCloud/client';

beforeEach(() => {
  process.env.WHATSAPP_CREDENTIALS_KEY = crypto.randomBytes(32).toString('hex');
  _resetKeyCache();
  vi.mocked(sendTemplateMessage).mockReset();
  vi.mocked(isOutOfSessionError).mockReset();
});

function makeProvider() {
  return new MetaCloudProvider('inst-1', {
    wabaId: 'waba',
    phoneNumberId: 'pn-x',
    accessToken: encryptSecret('plain-tok'),
    appSecret: encryptSecret('plain-sec'),
    webhookVerifyToken: 'verify-xyz-very-long',
    webhookSubscribed: true,
  });
}

describe('MetaCloudProvider.sendTemplate', () => {
  it('sends body-only template with no variables', async () => {
    vi.mocked(sendTemplateMessage).mockResolvedValueOnce({
      messageId: 'wamid.T1', rawPayload: {},
    });
    const res = await makeProvider().sendTemplate({
      to: '5511999', templateName: 'simple', language: 'pt_BR', variables: [],
    });
    expect(res.providerMsgId).toBe('wamid.T1');
    const call = vi.mocked(sendTemplateMessage).mock.calls[0][0];
    expect(call.name).toBe('simple');
    expect(call.language).toBe('pt_BR');
    expect(call.components).toEqual([]);
    expect(call.accessToken).toBe('plain-tok');   // decrypted
  });

  it('sends body template with variables in correct index order', async () => {
    vi.mocked(sendTemplateMessage).mockResolvedValueOnce({
      messageId: 'wamid.T2', rawPayload: {},
    });
    await makeProvider().sendTemplate({
      to: '5511', templateName: 'with_vars', language: 'pt_BR',
      variables: [
        { index: 3, value: 'three' },
        { index: 1, value: 'one' },
        { index: 2, value: 'two' },
      ],
    });
    const call = vi.mocked(sendTemplateMessage).mock.calls[0][0];
    expect(call.components).toHaveLength(1);
    expect(call.components![0].type).toBe('body');
    expect(call.components![0].parameters).toEqual([
      { type: 'text', text: 'one' },
      { type: 'text', text: 'two' },
      { type: 'text', text: 'three' },
    ]);
  });

  it('sends template with header image media', async () => {
    vi.mocked(sendTemplateMessage).mockResolvedValueOnce({
      messageId: 'wamid.T3', rawPayload: {},
    });
    await makeProvider().sendTemplate({
      to: '5511', templateName: 'hdr_img', language: 'pt_BR',
      variables: [{ index: 1, value: 'Lubritec' }],
      headerMedia: { kind: 'image', url: 'https://cdn/x.png' },
    });
    const call = vi.mocked(sendTemplateMessage).mock.calls[0][0];
    expect(call.components).toHaveLength(2);
    expect(call.components![0].type).toBe('header');
    expect(call.components![0].parameters[0]).toEqual({
      type: 'image', image: { link: 'https://cdn/x.png' },
    });
    expect(call.components![1].type).toBe('body');
  });

  it('translates Meta errors to ProviderError', async () => {
    vi.mocked(sendTemplateMessage).mockRejectedValueOnce(
      new MetaGraphError(500, null, { error: { message: 'down' } }),
    );
    vi.mocked(isOutOfSessionError).mockReturnValueOnce(false);
    await expect(
      makeProvider().sendTemplate({ to: '5511', templateName: 'x', language: 'pt_BR', variables: [] })
    ).rejects.toBeInstanceOf(ProviderError);
  });

  it('translates out-of-session Meta error to OutOfSessionWindowError', async () => {
    vi.mocked(sendTemplateMessage).mockRejectedValueOnce(
      new MetaGraphError(400, 131047, {}),
    );
    vi.mocked(isOutOfSessionError).mockReturnValueOnce(true);
    await expect(
      makeProvider().sendTemplate({ to: '5511', templateName: 'x', language: 'pt_BR', variables: [] })
    ).rejects.toBeInstanceOf(OutOfSessionWindowError);
  });
});
