import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createApp } from '../app';
import { db } from '../db/client';
import { conversations, messages, leads } from '../db/schema';
import { eq } from 'drizzle-orm';
import { createConversation, createLead } from './helpers';

const app = createApp();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SECRET = 'test-webhook-secret';
const textFixture = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'fixtures/uazapi-inbound-text.json'), 'utf8'),
);
const imageFixture = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'fixtures/uazapi-inbound-image.json'), 'utf8'),
);

beforeEach(() => {
  process.env.UAZAPI_WEBHOOK_SECRET = SECRET;
});

describe('POST /api/whatsapp/webhook', () => {
  it('401 sem header X-Webhook-Token', async () => {
    const res = await request(app).post('/api/whatsapp/webhook').send(textFixture);
    expect(res.status).toBe(401);
  });

  it('401 com header errado', async () => {
    const res = await request(app)
      .post('/api/whatsapp/webhook')
      .set('X-Webhook-Token', 'wrong')
      .send(textFixture);
    expect(res.status).toBe(401);
  });

  it('200 + ignora eventos não-mensagem', async () => {
    const res = await request(app)
      .post('/api/whatsapp/webhook')
      .set('X-Webhook-Token', SECRET)
      .send({ event: 'status.update', message: null });
    expect(res.status).toBe(200);
  });

  it('cria lead novo se telefone não bate', async () => {
    const res = await request(app)
      .post('/api/whatsapp/webhook')
      .set('X-Webhook-Token', SECRET)
      .send(textFixture);
    expect(res.status).toBe(200);

    const [lead] = await db.select().from(leads).where(eq(leads.phone, '5511987654321'));
    expect(lead).toBeDefined();
    expect(lead.source).toBe('whatsapp');
    expect(lead.name).toBe('5511987654321');
  });

  it('vincula a lead existente sem criar duplicata', async () => {
    await createLead({ phone: '5511987654321', name: 'João Existente' });

    const res = await request(app)
      .post('/api/whatsapp/webhook')
      .set('X-Webhook-Token', SECRET)
      .send(textFixture);
    expect(res.status).toBe(200);

    const all = await db.select().from(leads).where(eq(leads.phone, '5511987654321'));
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('João Existente');
  });

  it('cria conversation com queue=recepcao e status=aguardando_atendimento', async () => {
    await request(app)
      .post('/api/whatsapp/webhook')
      .set('X-Webhook-Token', SECRET)
      .send(textFixture);

    const [conv] = await db.select().from(conversations).where(eq(conversations.phone, '5511987654321'));
    expect(conv.queue).toBe('recepcao');
    expect(conv.status).toBe('aguardando_atendimento');
    expect(conv.originKind).toBe('organic');
    expect(conv.unreadCount).toBe(1);
    expect(conv.lastInboundAt).not.toBeNull();
  });

  it('insere mensagem com direction=in, body, raw_payload', async () => {
    await request(app)
      .post('/api/whatsapp/webhook')
      .set('X-Webhook-Token', SECRET)
      .send(textFixture);

    const [conv] = await db.select().from(conversations).where(eq(conversations.phone, '5511987654321'));
    const msgs = await db.select().from(messages).where(eq(messages.conversationId, conv.id));
    expect(msgs).toHaveLength(1);
    expect(msgs[0].direction).toBe('in');
    expect(msgs[0].kind).toBe('text');
    expect(msgs[0].body).toMatch(/Civic/);
    expect(msgs[0].uazapiMsgId).toBe('ABCD-1234-EFGH');
  });

  it('idempotência: webhook duplicado é no-op', async () => {
    await request(app)
      .post('/api/whatsapp/webhook')
      .set('X-Webhook-Token', SECRET)
      .send(textFixture);
    const r2 = await request(app)
      .post('/api/whatsapp/webhook')
      .set('X-Webhook-Token', SECRET)
      .send(textFixture);
    expect(r2.status).toBe(200);

    const [conv] = await db.select().from(conversations).where(eq(conversations.phone, '5511987654321'));
    const msgs = await db.select().from(messages).where(eq(messages.conversationId, conv.id));
    expect(msgs).toHaveLength(1);
    expect(conv.unreadCount).toBe(1);
  });

  it('reabre conversa encerrada quando cliente manda nova msg', async () => {
    const lead = await createLead({ phone: '5511987654321' });
    await createConversation({
      phone: '5511987654321',
      leadId: lead.id,
      status: 'encerrada',
    });

    await request(app)
      .post('/api/whatsapp/webhook')
      .set('X-Webhook-Token', SECRET)
      .send(textFixture);

    const [conv] = await db.select().from(conversations).where(eq(conversations.phone, '5511987654321'));
    expect(conv.status).toBe('aguardando_atendimento');
    expect(conv.unreadCount).toBe(1);
  });

  it('mensagem com mídia: kind=image, mediaUrl preenchido, body null', async () => {
    await request(app)
      .post('/api/whatsapp/webhook')
      .set('X-Webhook-Token', SECRET)
      .send(imageFixture);

    const [conv] = await db.select().from(conversations).where(eq(conversations.phone, '5511987654321'));
    const msgs = await db.select().from(messages).where(eq(messages.conversationId, conv.id));
    expect(msgs[0].kind).toBe('image');
    expect(msgs[0].mediaUrl).toBe('https://uazapi-cdn.example.com/media/abc123.jpg');
    expect(msgs[0].mediaMime).toBe('image/jpeg');
    expect(msgs[0].body).toBeNull();
  });
});
