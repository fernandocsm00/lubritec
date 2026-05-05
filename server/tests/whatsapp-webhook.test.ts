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

  // -------------------------------------------------------------------------
  // Formato real da uazapiGO (varia por versão; aceitamos defensivamente).
  // -------------------------------------------------------------------------

  it('aceita formato uazapiGO: EventType + message.messageid + message.sender', async () => {
    const res = await request(app)
      .post('/api/whatsapp/webhook')
      .set('X-Webhook-Token', SECRET)
      .send({
        EventType: 'messages',
        message: {
          messageid: 'UAZGO-MSG-001',
          sender: '5511955554444@s.whatsapp.net',
          messageType: 'conversation',
          text: 'oi tudo bem',
          timestamp: 1746115200,
        },
      });
    expect(res.status).toBe(200);

    const [conv] = await db.select().from(conversations).where(eq(conversations.phone, '5511955554444'));
    expect(conv).toBeDefined();
    const msgs = await db.select().from(messages).where(eq(messages.conversationId, conv.id));
    expect(msgs).toHaveLength(1);
    expect(msgs[0].uazapiMsgId).toBe('UAZGO-MSG-001');
    expect(msgs[0].kind).toBe('text');
    expect(msgs[0].body).toBe('oi tudo bem');
  });

  it('filtra fromMe=true (mensagem outbound já gravada via sendMessage)', async () => {
    const res = await request(app)
      .post('/api/whatsapp/webhook')
      .set('X-Webhook-Token', SECRET)
      .send({
        EventType: 'messages',
        message: {
          messageid: 'UAZGO-MSG-OUT',
          sender: '5511944443333@s.whatsapp.net',
          fromMe: true,
          messageType: 'conversation',
          text: 'enviei eu mesmo',
          timestamp: Math.floor(Date.now() / 1000),
        },
      });
    expect(res.status).toBe(200);
    const all = await db.select().from(messages).where(eq(messages.uazapiMsgId, 'UAZGO-MSG-OUT'));
    expect(all).toHaveLength(0);
  });

  it('aceita token no header `token` (uazapiGO comum) em vez de X-Webhook-Token', async () => {
    const res = await request(app)
      .post('/api/whatsapp/webhook')
      .set('token', SECRET)
      .send({
        EventType: 'messages',
        message: {
          messageid: 'UAZGO-MSG-AUTH-HEADER',
          sender: '5511933332222',
          messageType: 'conversation',
          text: 'auth via token header',
          timestamp: Math.floor(Date.now() / 1000),
        },
      });
    expect(res.status).toBe(200);
    const [m] = await db.select().from(messages).where(eq(messages.uazapiMsgId, 'UAZGO-MSG-AUTH-HEADER'));
    expect(m).toBeDefined();
  });

  it('aceita token no body (campo `token`)', async () => {
    const res = await request(app)
      .post('/api/whatsapp/webhook')
      .send({
        token: SECRET,
        EventType: 'messages',
        message: {
          messageid: 'UAZGO-MSG-AUTH-BODY',
          sender: '5511922221111',
          messageType: 'conversation',
          text: 'auth via body token',
          timestamp: Math.floor(Date.now() / 1000),
        },
      });
    expect(res.status).toBe(200);
    const [m] = await db.select().from(messages).where(eq(messages.uazapiMsgId, 'UAZGO-MSG-AUTH-BODY'));
    expect(m).toBeDefined();
  });

  it('aceita formato Baileys-like: messageType=imageMessage + mediaUrl', async () => {
    const res = await request(app)
      .post('/api/whatsapp/webhook')
      .set('X-Webhook-Token', SECRET)
      .send({
        EventType: 'messages',
        message: {
          messageid: 'UAZGO-IMG-001',
          chatid: '5511911110000@s.whatsapp.net',
          messageType: 'imageMessage',
          mediaUrl: 'https://cdn.example.com/photo.jpg',
          mimetype: 'image/jpeg',
          caption: 'olha essa foto',
          timestamp: Math.floor(Date.now() / 1000),
        },
      });
    expect(res.status).toBe(200);
    const [m] = await db.select().from(messages).where(eq(messages.uazapiMsgId, 'UAZGO-IMG-001'));
    expect(m).toBeDefined();
    expect(m.kind).toBe('image');
    expect(m.mediaUrl).toBe('https://cdn.example.com/photo.jpg');
    expect(m.mediaMime).toBe('image/jpeg');
  });

  it('200 quando payload não é mensagem (presence, status, etc.)', async () => {
    const res = await request(app)
      .post('/api/whatsapp/webhook')
      .set('X-Webhook-Token', SECRET)
      .send({ EventType: 'presence', status: 'available' });
    expect(res.status).toBe(200);
  });

  it('usa pushName do WhatsApp como nome do lead quando criando lead novo', async () => {
    const res = await request(app)
      .post('/api/whatsapp/webhook')
      .set('X-Webhook-Token', SECRET)
      .send({
        EventType: 'messages',
        message: {
          messageid: 'UAZGO-PUSHNAME-001',
          sender: '5511988887777@s.whatsapp.net',
          pushName: 'João da Silva',
          messageType: 'conversation',
          text: 'oi',
          timestamp: Math.floor(Date.now() / 1000),
        },
      });
    expect(res.status).toBe(200);
    const [lead] = await db.select().from(leads).where(eq(leads.phone, '5511988887777'));
    expect(lead).toBeDefined();
    expect(lead.name).toBe('João da Silva');
  });

  it('promove nome de lead existente quando estava como telefone e chega pushName real', async () => {
    // Lead pré-existente com nome = phone (criado em msg anterior sem pushName)
    await createLead({ phone: '5511977776666', name: '5511977776666' });

    await request(app)
      .post('/api/whatsapp/webhook')
      .set('X-Webhook-Token', SECRET)
      .send({
        EventType: 'messages',
        message: {
          messageid: 'UAZGO-PROMOTE-001',
          sender: '5511977776666@s.whatsapp.net',
          pushName: 'Maria Santos',
          messageType: 'conversation',
          text: 'voltei',
          timestamp: Math.floor(Date.now() / 1000),
        },
      });

    const [lead] = await db.select().from(leads).where(eq(leads.phone, '5511977776666'));
    expect(lead.name).toBe('Maria Santos');
  });

  it('lead novo via inbound entra com flow_stage=engaged', async () => {
    await request(app)
      .post('/api/whatsapp/webhook')
      .set('X-Webhook-Token', SECRET)
      .send({
        EventType: 'messages',
        message: {
          messageid: 'UAZGO-FLOW-001',
          sender: '5511955551111@s.whatsapp.net',
          messageType: 'conversation',
          text: 'oi',
          timestamp: Math.floor(Date.now() / 1000),
        },
      });
    const [lead] = await db.select().from(leads).where(eq(leads.phone, '5511955551111'));
    expect(lead.flowStage).toBe('engaged');
  });

  it('promove flow_stage de complete pra engaged em lead pré-existente', async () => {
    await createLead({ phone: '5511944442222', flowStage: 'complete' });
    await request(app)
      .post('/api/whatsapp/webhook')
      .set('X-Webhook-Token', SECRET)
      .send({
        EventType: 'messages',
        message: {
          messageid: 'UAZGO-FLOW-002',
          sender: '5511944442222',
          messageType: 'conversation',
          text: 'oi',
          timestamp: Math.floor(Date.now() / 1000),
        },
      });
    const [lead] = await db.select().from(leads).where(eq(leads.phone, '5511944442222'));
    expect(lead.flowStage).toBe('engaged');
  });

  it('NÃO regride flow_stage de qualified pra engaged', async () => {
    await createLead({ phone: '5511933333333', flowStage: 'qualified' });
    await request(app)
      .post('/api/whatsapp/webhook')
      .set('X-Webhook-Token', SECRET)
      .send({
        EventType: 'messages',
        message: {
          messageid: 'UAZGO-FLOW-003',
          sender: '5511933333333',
          messageType: 'conversation',
          text: 'oi',
          timestamp: Math.floor(Date.now() / 1000),
        },
      });
    const [lead] = await db.select().from(leads).where(eq(leads.phone, '5511933333333'));
    expect(lead.flowStage).toBe('qualified');
  });

  it('NÃO sobrescreve nome customizado quando chega pushName diferente', async () => {
    await createLead({ phone: '5511966665555', name: 'Cliente Importante (custom)' });

    await request(app)
      .post('/api/whatsapp/webhook')
      .set('X-Webhook-Token', SECRET)
      .send({
        EventType: 'messages',
        message: {
          messageid: 'UAZGO-NOOVERWRITE-001',
          sender: '5511966665555@s.whatsapp.net',
          pushName: 'Outro Nome',
          messageType: 'conversation',
          text: 'oi',
          timestamp: Math.floor(Date.now() / 1000),
        },
      });

    const [lead] = await db.select().from(leads).where(eq(leads.phone, '5511966665555'));
    expect(lead.name).toBe('Cliente Importante (custom)');
  });
});
