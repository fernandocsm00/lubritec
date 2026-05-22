import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'node:crypto';
import { MetaCloudProvider } from '../services/whatsapp/metaCloud/provider';
import { encryptSecret, _resetKeyCache } from '../lib/crypto';
import {
  ProviderError,
  OutOfSessionWindowError,
} from '../services/whatsapp/provider';

vi.mock('../services/whatsapp/metaCloud/client', () => ({
  getPhoneNumberInfo: vi.fn(),
  sendText: vi.fn(),
  sendMedia: vi.fn(),
  getMediaUrl: vi.fn(),
  isOutOfSessionError: vi.fn(),
  MetaGraphError: class extends Error {
    constructor(public status: number, public code: number | null, public body: unknown) {
      super(`${status}`); this.name = 'MetaGraphError';
    }
  },
}));
import {
  getPhoneNumberInfo,
  sendText,
  sendMedia,
  isOutOfSessionError,
  MetaGraphError,
} from '../services/whatsapp/metaCloud/client';

beforeEach(() => {
  process.env.WHATSAPP_CREDENTIALS_KEY = crypto.randomBytes(32).toString('hex');
  _resetKeyCache();
  vi.mocked(getPhoneNumberInfo).mockReset();
  vi.mocked(sendText).mockReset();
  vi.mocked(sendMedia).mockReset();
  vi.mocked(isOutOfSessionError).mockReset();
});

function makeProvider(overrides: Partial<{
  accessToken: string;
  appSecret: string;
  wabaId: string;
  phoneNumberId: string;
}> = {}) {
  return new MetaCloudProvider('inst-uuid-1', {
    wabaId: overrides.wabaId ?? 'waba-123',
    phoneNumberId: overrides.phoneNumberId ?? 'pn-456',
    accessToken: encryptSecret(overrides.accessToken ?? 'plain-token'),
    appSecret: encryptSecret(overrides.appSecret ?? 'plain-secret'),
    webhookVerifyToken: 'verify-xyz',
    webhookSubscribed: false,
  });
}

describe('MetaCloudProvider', () => {
  it('kind is meta_cloud', () => {
    expect(makeProvider().kind).toBe('meta_cloud');
  });

  it('getStatus returns connected with phone info when Graph call succeeds', async () => {
    vi.mocked(getPhoneNumberInfo).mockResolvedValueOnce({
      id: 'pn-456',
      display_phone_number: '+55 11 99999-0000',
      verified_name: 'Lubritec',
    });
    const status = await makeProvider().getStatus();
    expect(status.status).toBe('connected');
    expect(status.phoneNumber).toBe('+55 11 99999-0000');
    expect(status.profileName).toBe('Lubritec');
  });

  it('getStatus returns error when Graph call fails', async () => {
    vi.mocked(getPhoneNumberInfo).mockRejectedValueOnce(
      new MetaGraphError(401, 190, { error: { message: 'invalid token' } }),
    );
    const status = await makeProvider().getStatus();
    expect(status.status).toBe('error');
  });

  it('sendText decrypts token and calls client', async () => {
    vi.mocked(sendText).mockResolvedValueOnce({
      messageId: 'wamid.HBgX', rawPayload: { messages: [{ id: 'wamid.HBgX' }] },
    });
    const res = await makeProvider({ accessToken: 'plain-token' }).sendText({
      to: '5511999999999', text: 'olá',
    });
    expect(res.providerMsgId).toBe('wamid.HBgX');
    const call = vi.mocked(sendText).mock.calls[0][0];
    expect(call.accessToken).toBe('plain-token');   // decrypted
    expect(call.phoneNumberId).toBe('pn-456');
    expect(call.to).toBe('5511999999999');
    expect(call.text).toBe('olá');
  });

  it('sendText translates out-of-session error to OutOfSessionWindowError', async () => {
    const metaErr = new MetaGraphError(400, 131047, {});
    vi.mocked(sendText).mockRejectedValueOnce(metaErr);
    vi.mocked(isOutOfSessionError).mockReturnValueOnce(true);
    await expect(
      makeProvider().sendText({ to: '5511999', text: 'oi' })
    ).rejects.toBeInstanceOf(OutOfSessionWindowError);
  });

  it('sendText wraps other Meta errors as ProviderError', async () => {
    const metaErr = new MetaGraphError(500, null, { error: { message: 'down' } });
    vi.mocked(sendText).mockRejectedValueOnce(metaErr);
    vi.mocked(isOutOfSessionError).mockReturnValueOnce(false);
    await expect(
      makeProvider().sendText({ to: '5511999', text: 'oi' })
    ).rejects.toBeInstanceOf(ProviderError);
  });

  it('sendMedia delegates with kind + url + caption', async () => {
    vi.mocked(sendMedia).mockResolvedValueOnce({
      messageId: 'wamid.MEDIA', rawPayload: {},
    });
    const res = await makeProvider().sendMedia({
      to: '5511999', kind: 'image', mediaUrl: 'https://x/y.png', caption: 'hi',
    });
    expect(res.providerMsgId).toBe('wamid.MEDIA');
    const call = vi.mocked(sendMedia).mock.calls[0][0];
    expect(call.kind).toBe('image');
    expect(call.mediaUrl).toBe('https://x/y.png');
    expect(call.caption).toBe('hi');
  });

  it('capabilities reflect Meta restrictions', () => {
    const caps = makeProvider().capabilities();
    expect(caps.freeFormText).toBe(true);
    expect(caps.requiresApprovedTemplate).toBe(true);
    expect(caps.supportsMedia).toBe(true);
    expect(caps.supportsButtons).toBe(true);
  });

  it('connect is a no-op that returns current status', async () => {
    vi.mocked(getPhoneNumberInfo).mockResolvedValueOnce({
      id: 'pn-456', display_phone_number: '+55 11 99999-0000', verified_name: 'L',
    });
    const status = await makeProvider().connect();
    expect(status.status).toBe('connected');
  });

  it('disconnect is a no-op (Meta has no logout concept)', async () => {
    await expect(makeProvider().disconnect()).resolves.toBeUndefined();
  });
});
