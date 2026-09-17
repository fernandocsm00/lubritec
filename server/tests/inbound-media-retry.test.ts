import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../app';
import { db } from '../db/client';
import { messages } from '../db/schema';
import { encryptSecret } from '../lib/crypto';
import { createUser, createLead, createConversation, createMessage, createWhatsappInstance } from './helpers';

vi.mock('../services/whatsapp/metaCloud/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/whatsapp/metaCloud/client')>()),
  getMediaUrl: vi.fn(),
  downloadMedia: vi.fn(),
}));
vi.mock('../services/whatsapp/uazapi/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/whatsapp/uazapi/client')>()),
  downloadUazapiMedia: vi.fn(),
}));
vi.mock('../services/whatsapp/inboundMediaStore', () => ({
  persistInboundMedia: vi.fn(async () => '/uploads/inbound/retry123.ogg'),
}));

import { getMediaUrl, downloadMedia, MetaGraphError } from '../services/whatsapp/metaCloud/client';
import { downloadUazapiMedia } from '../services/whatsapp/uazapi/client';

const app = createApp();

async function login() {
  await createUser({ email: 'retry@x.com', password: 'pw12345', role: 'comercial' });
  const res = await request(app).post('/api/auth/login').send({ email: 'retry@x.com', password: 'pw12345' });
  return res.body.accessToken as string;
}

async function setupMetaAudio(body: string | null = '🎵 Áudio') {
  const inst = await createWhatsappInstance({
    provider: 'meta_cloud',
    providerConfig: {
      wabaId: 'w', phoneNumberId: 'p', accessToken: encryptSecret('meta-token'),
      appSecret: encryptSecret('app-secret'), webhookVerifyToken: 'verify-token-123',
    },
  });
  const lead = await createLead({});
  const conv = await createConversation({ leadId: lead.id, instanceId: inst.id });
  const msg = await createMessage({
    conversationId: conv.id, direction: 'in', kind: 'audio', provider: 'meta_cloud',
    body: 'placeholder', mediaUrl: null,
    rawPayload: { type: 'audio', audio: { id: 'MEDIA_1', mime_type: 'audio/ogg' } },
  });
  // helper troca body null pelo default — ajusta direto.
  await db.update(messages).set({ body }).where(eq(messages.id, msg.id));
  return { conv, msg };
}

const retryUrl = (convId: string, msgId: string) =>
  `/api/conversations/${convId}/messages/${msgId}/retry-media`;

beforeEach(() => {
  vi.mocked(getMediaUrl).mockReset();
  vi.mocked(downloadMedia).mockReset();
  vi.mocked(downloadUazapiMedia).mockReset();
});

describe('POST /api/conversations/:id/messages/:msgId/retry-media', () => {
  it('401 sem token', async () => {
    const res = await request(app).post(retryUrl(
      '00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000',
    ));
    expect(res.status).toBe(401);
  });

  it('Meta: baixa pelo media id do raw_payload, grava local e tira o rótulo fallback', async () => {
    const token = await login();
    const { conv, msg } = await setupMetaAudio();
    vi.mocked(getMediaUrl).mockResolvedValueOnce({ url: 'https://lookaside/x', mimeType: 'audio/ogg' });
    vi.mocked(downloadMedia).mockResolvedValueOnce({ buffer: Buffer.from('ogg'), mimeType: 'audio/ogg' });

    const res = await request(app).post(retryUrl(conv.id, msg.id)).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.mediaUrl).toBe('/uploads/inbound/retry123.ogg');
    expect(res.body.body).toBeNull();
    expect(getMediaUrl).toHaveBeenCalledWith({ mediaId: 'MEDIA_1', accessToken: 'meta-token' });
  });

  it('mensagem antiga sem body (antes do fix) também recupera', async () => {
    const token = await login();
    const { conv, msg } = await setupMetaAudio(null);
    vi.mocked(getMediaUrl).mockResolvedValueOnce({ url: 'https://lookaside/x', mimeType: 'audio/ogg' });
    vi.mocked(downloadMedia).mockResolvedValueOnce({ buffer: Buffer.from('ogg'), mimeType: 'audio/ogg' });

    const res = await request(app).post(retryUrl(conv.id, msg.id)).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.mediaUrl).toBe('/uploads/inbound/retry123.ogg');
  });

  it('token da Meta recusado: 502 com mensagem clara e nada muda', async () => {
    const token = await login();
    const { conv, msg } = await setupMetaAudio();
    vi.mocked(getMediaUrl).mockRejectedValueOnce(new MetaGraphError(401, 190, { error: { code: 190 } }));

    const res = await request(app).post(retryUrl(conv.id, msg.id)).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/token expirado/);
    const [after] = await db.select().from(messages).where(eq(messages.id, msg.id));
    expect(after.mediaUrl).toBeNull();
    expect(after.body).toBe('🎵 Áudio');
  });

  it('UazAPI: baixa pelo provider_msg_id com a config da linha da conversa', async () => {
    const token = await login();
    const lead = await createLead({});
    const conv = await createConversation({ leadId: lead.id });
    const msg = await createMessage({
      conversationId: conv.id, direction: 'in', kind: 'image', provider: 'uazapi',
      body: '🖼️ Imagem', mediaUrl: null, providerMsgId: 'UAZ-1',
    });
    vi.mocked(downloadUazapiMedia).mockResolvedValueOnce({ buffer: Buffer.from('jpg'), mime: 'image/jpeg' } as never);

    const res = await request(app).post(retryUrl(conv.id, msg.id)).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.mediaUrl).toBe('/uploads/inbound/retry123.ogg');
    expect(downloadUazapiMedia).toHaveBeenCalledWith('UAZ-1', expect.objectContaining({ token: 'test-instance-token' }));
  });

  it('400 pra mensagem de texto ou enviada por nós', async () => {
    const token = await login();
    const lead = await createLead({});
    const conv = await createConversation({ leadId: lead.id });
    const text = await createMessage({ conversationId: conv.id, direction: 'in', kind: 'text' });
    const out = await createMessage({ conversationId: conv.id, direction: 'out', kind: 'audio' });

    for (const m of [text, out]) {
      const res = await request(app).post(retryUrl(conv.id, m.id)).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
    }
  });

  it('404 quando a mensagem não é da conversa da URL', async () => {
    const token = await login();
    const { msg } = await setupMetaAudio();
    const lead = await createLead({});
    const other = await createConversation({ leadId: lead.id });
    const res = await request(app).post(retryUrl(other.id, msg.id)).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
