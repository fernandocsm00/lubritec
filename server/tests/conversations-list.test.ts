import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { createUser, createLead, createConversation, createMessage } from './helpers';

const app = createApp();

async function loginAs(email: string, password = 'pw12345') {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return res.body.accessToken as string;
}

async function seedAuth() {
  await createUser({ email: 'r@x.com', password: 'pw12345', role: 'recepcao' });
  return loginAs('r@x.com');
}

describe('GET /api/conversations', () => {
  it('401 sem token', async () => {
    const res = await request(app).get('/api/conversations');
    expect(res.status).toBe(401);
  });

  it('200 lista paginada', async () => {
    const token = await seedAuth();
    const lead = await createLead({ phone: '11000010001' });
    const c = await createConversation({ phone: '11000010001', leadId: lead.id });
    await createMessage({ conversationId: c.id, body: 'oi' });

    const res = await request(app).get('/api/conversations').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toBeInstanceOf(Array);
    expect(res.body.total).toBeGreaterThan(0);
    expect(res.body.pageSize).toBe(50);
  });

  it('filtra por queue', async () => {
    const token = await seedAuth();
    const lead = await createLead({ phone: '11000010002' });
    await createConversation({ phone: '11000010002', leadId: lead.id, queue: 'comercial' });
    const lead2 = await createLead({ phone: '11000010003' });
    await createConversation({ phone: '11000010003', leadId: lead2.id, queue: 'recepcao' });

    const res = await request(app)
      .get('/api/conversations?queue=comercial')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].queue).toBe('comercial');
  });

  it('filtra por status (CSV multi-valor)', async () => {
    const token = await seedAuth();
    const lead = await createLead({ phone: '11000010010' });
    await createConversation({ phone: '11000010010', leadId: lead.id, status: 'em_atendimento' });
    const lead2 = await createLead({ phone: '11000010011' });
    await createConversation({ phone: '11000010011', leadId: lead2.id, status: 'encerrada' });

    const res = await request(app)
      .get('/api/conversations?status=em_atendimento,aguardando_atendimento')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items.every((c: { status: string }) =>
      ['em_atendimento', 'aguardando_atendimento'].includes(c.status))).toBe(true);
  });

  it('filtra por expired24h', async () => {
    const token = await seedAuth();
    const lead = await createLead({ phone: '11000010020' });
    await createConversation({
      phone: '11000010020',
      leadId: lead.id,
      lastInboundAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    });
    const lead2 = await createLead({ phone: '11000010021' });
    await createConversation({
      phone: '11000010021',
      leadId: lead2.id,
      lastInboundAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
    });

    const res = await request(app)
      .get('/api/conversations?expired24h=true')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].phone).toBe('11000010020');
  });

  it('filtra por noResponse (campanha sem msg in há mais de 7 dias)', async () => {
    const token = await seedAuth();
    const lead = await createLead({ phone: '11000010030' });
    await createConversation({
      phone: '11000010030',
      leadId: lead.id,
      originKind: 'campaign',
      originCampaignId: '00000000-0000-0000-0000-000000000001',
      lastInboundAt: null,
      lastMessageAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    });

    const res = await request(app)
      .get('/api/conversations?noResponse=true')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items.every((c: { phone: string }) => c.phone === '11000010030')).toBe(true);
  });

  it('filtra por assignment=mine', async () => {
    const u = await createUser({ email: 'mine@x.com', password: 'pw12345', role: 'recepcao' });
    const token = await loginAs('mine@x.com');

    const lead = await createLead({ phone: '11000010040' });
    await createConversation({ phone: '11000010040', leadId: lead.id, assignedTo: u.id });
    const lead2 = await createLead({ phone: '11000010041' });
    await createConversation({ phone: '11000010041', leadId: lead2.id, assignedTo: null });

    const res = await request(app)
      .get('/api/conversations?assignment=mine')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].phone).toBe('11000010040');
  });

  it('filtra por busca de texto (nome do lead, telefone)', async () => {
    const token = await seedAuth();
    const lead = await createLead({ phone: '11000010050', name: 'João Silva' });
    await createConversation({ phone: '11000010050', leadId: lead.id });

    const res = await request(app)
      .get('/api/conversations?q=Silva')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items.some((c: { lead: { name: string } }) => c.lead.name.includes('Silva'))).toBe(true);
  });

  it('inclui lastMessagePreview e lead expandido', async () => {
    const token = await seedAuth();
    const lead = await createLead({ phone: '11000010060', name: 'Maria' });
    const c = await createConversation({ phone: '11000010060', leadId: lead.id });
    await createMessage({ conversationId: c.id, body: 'última mensagem aqui', direction: 'in' });

    const res = await request(app).get('/api/conversations').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const item = res.body.items.find((it: { phone: string }) => it.phone === '11000010060');
    expect(item.lead.name).toBe('Maria');
    expect(item.lastMessagePreview).toBe('última mensagem aqui');
    expect(item.lastMessageDirection).toBe('in');
  });
});

describe('GET /api/conversations/counts', () => {
  it('401 sem token', async () => {
    const res = await request(app).get('/api/conversations/counts');
    expect(res.status).toBe(401);
  });

  it('retorna contadores por fila excluindo encerradas', async () => {
    const token = await seedAuth();
    const lead = await createLead({ phone: '11000020001' });
    await createConversation({ phone: '11000020001', leadId: lead.id, queue: 'recepcao' });
    const lead2 = await createLead({ phone: '11000020002' });
    await createConversation({ phone: '11000020002', leadId: lead2.id, queue: 'comercial' });
    const lead3 = await createLead({ phone: '11000020003' });
    await createConversation({ phone: '11000020003', leadId: lead3.id, queue: 'recepcao', status: 'encerrada' });

    const res = await request(app).get('/api/conversations/counts').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ia: 0, recepcao: 1, comercial: 1 });
  });
});
