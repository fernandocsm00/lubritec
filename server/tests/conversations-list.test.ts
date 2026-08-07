import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { createUser, createLead, createConversation, createMessage, createCampaign, createHsmTemplate, getOrCreateDefaultInstance, createWhatsappInstance } from './helpers';

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

  it('filtra por linha (instanceId) e expõe instanceId no item', async () => {
    const token = await seedAuth();
    const lineA = await getOrCreateDefaultInstance();
    const lineB = await createWhatsappInstance({ displayName: 'Linha B', isDefault: false });

    const leadA = await createLead({ phone: '11000019001' });
    const convA = await createConversation({ phone: '11000019001', leadId: leadA.id, instanceId: lineA });
    await createMessage({ conversationId: convA.id, body: 'da linha A' });

    const leadB = await createLead({ phone: '11000019002' });
    const convB = await createConversation({ phone: '11000019002', leadId: leadB.id, instanceId: lineB.id });
    await createMessage({ conversationId: convB.id, body: 'da linha B' });

    // Sem filtro: as duas aparecem, cada uma com seu instanceId.
    const all = await request(app).get('/api/conversations').set('Authorization', `Bearer ${token}`);
    expect(all.status).toBe(200);
    const ids = all.body.items.map((i: { instanceId: string }) => i.instanceId);
    expect(ids).toContain(lineA);
    expect(ids).toContain(lineB.id);

    // Filtrando pela linha B: só a conversa da B.
    const onlyB = await request(app)
      .get(`/api/conversations?instanceId=${lineB.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(onlyB.status).toBe(200);
    expect(onlyB.body.items).toHaveLength(1);
    expect(onlyB.body.items[0].id).toBe(convB.id);
    expect(onlyB.body.items[0].instanceId).toBe(lineB.id);
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

  it('filtra por awaitingUs (última mensagem é do cliente, sem resposta nossa)', async () => {
    const token = await seedAuth();
    // Espera resposta: última msg é do cliente (lastMessageAt == lastInboundAt),
    // e a conversa está na fila comercial (regra de awaitingUsSql).
    const lead = await createLead({ phone: '11000010020' });
    const espera = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await createConversation({
      phone: '11000010020',
      leadId: lead.id,
      queue: 'comercial',
      status: 'em_atendimento',
      lastInboundAt: espera,
      lastMessageAt: espera,
    });
    // Já respondida: lastMessageAt posterior ao lastInboundAt — não entra.
    const lead2 = await createLead({ phone: '11000010021' });
    const inbound2 = new Date(Date.now() - 1 * 60 * 60 * 1000);
    await createConversation({
      phone: '11000010021',
      leadId: lead2.id,
      queue: 'comercial',
      status: 'em_atendimento',
      lastInboundAt: inbound2,
      lastMessageAt: new Date(inbound2.getTime() + 5 * 60 * 1000),
    });

    const res = await request(app)
      .get('/api/conversations?awaitingUs=true')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].phone).toBe('11000010020');
  });

  it('filtra por noResponse (campanha sem msg in há mais de 7 dias)', async () => {
    const token = await seedAuth();
    const lead = await createLead({ phone: '11000010030' });
    const campaignOwner = await createUser({ email: 'campaign-owner@x.com', role: 'comercial' });
    const campaign = await createCampaign({ createdByUserId: campaignOwner.id });
    await createConversation({
      phone: '11000010030',
      leadId: lead.id,
      originKind: 'campaign',
      originCampaignId: campaign.id,
      lastInboundAt: null,
      lastMessageAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    });

    const res = await request(app)
      .get('/api/conversations?noResponse=true')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items.every((c: { phone: string }) => c.phone === '11000010030')).toBe(true);
    const item = res.body.items.find((c: { phone: string }) => c.phone === '11000010030');
    expect(item).toBeDefined();
    expect(item.originCampaignName).toBe(campaign.name);
  });

  it('retorna originCampaignName null em conversa orgânica', async () => {
    const token = await seedAuth();
    const lead = await createLead({ phone: '11000010045' });
    await createConversation({
      phone: '11000010045',
      leadId: lead.id,
      originKind: 'organic',
      originCampaignId: null,
    });

    const res = await request(app)
      .get('/api/conversations')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const item = res.body.items.find((c: { phone: string }) => c.phone === '11000010045');
    expect(item).toBeDefined();
    expect(item.originCampaignName).toBeNull();
  });

  it('originCampaignMessage = corpo do disparo real enviado', async () => {
    const token = await seedAuth();
    const lead = await createLead({ phone: '11000010050' });
    const owner = await createUser({ email: 'camp-msg@x.com', role: 'comercial' });
    const campaign = await createCampaign({
      createdByUserId: owner.id,
      messageBody: 'Template com {{nome}}',
    });
    const conv = await createConversation({
      phone: '11000010050',
      leadId: lead.id,
      originKind: 'campaign',
      originCampaignId: campaign.id,
      lastInboundAt: new Date(),
    });
    await createMessage({
      conversationId: conv.id,
      direction: 'out',
      body: 'Olá João, temos uma oferta pra você!',
    });

    const res = await request(app)
      .get('/api/conversations')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const item = res.body.items.find((c: { phone: string }) => c.phone === '11000010050');
    expect(item).toBeDefined();
    expect(item.originCampaignMessage).toBe('Olá João, temos uma oferta pra você!');
  });

  it('originCampaignMessage cai no messageBody da campanha quando não há outbound', async () => {
    const token = await seedAuth();
    const lead = await createLead({ phone: '11000010051' });
    const owner = await createUser({ email: 'camp-fallback@x.com', role: 'comercial' });
    const campaign = await createCampaign({
      createdByUserId: owner.id,
      messageBody: 'Mensagem padrão da campanha',
    });
    await createConversation({
      phone: '11000010051',
      leadId: lead.id,
      originKind: 'campaign',
      originCampaignId: campaign.id,
      lastInboundAt: new Date(),
    });

    const res = await request(app)
      .get('/api/conversations')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const item = res.body.items.find((c: { phone: string }) => c.phone === '11000010051');
    expect(item).toBeDefined();
    expect(item.originCampaignMessage).toBe('Mensagem padrão da campanha');
  });

  it('originCampaignMessage = BODY do template em campanha HSM', async () => {
    const token = await seedAuth();
    const lead = await createLead({ phone: '11000010060' });
    const owner = await createUser({ email: 'hsm-hover@x.com', role: 'comercial' });
    const instanceId = await getOrCreateDefaultInstance();
    const tpl = await createHsmTemplate({
      instanceId,
      createdBy: owner.id,
      status: 'APPROVED',
      components: [{ type: 'BODY', text: 'Olá {{1}}, faz tempo que não te vemos!' }],
    });
    const campaign = await createCampaign({
      createdByUserId: owner.id,
      instanceId,
      hsmTemplateId: tpl.id,
      messageBody: '',
    });
    const conv = await createConversation({
      phone: '11000010060',
      leadId: lead.id,
      originKind: 'campaign',
      originCampaignId: campaign.id,
      lastInboundAt: new Date(),
    });
    // O outbound guarda o NOME do template — o hover deve mostrar o BODY, não o nome.
    await createMessage({ conversationId: conv.id, direction: 'out', body: tpl.name });

    const res = await request(app)
      .get('/api/conversations')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const item = res.body.items.find((c: { phone: string }) => c.phone === '11000010060');
    expect(item).toBeDefined();
    expect(item.originCampaignMessage).toBe('Olá {{1}}, faz tempo que não te vemos!');
  });

  it('filtra por uf (RS inclui leads sem UF; BA só BA)', async () => {
    const token = await seedAuth();
    const leadRs = await createLead({ phone: '11000010070', uf: 'RS' });
    const leadBa = await createLead({ phone: '11000010071', uf: 'BA' });
    const leadNull = await createLead({ phone: '11000010072', uf: null });
    await createConversation({ phone: '11000010070', leadId: leadRs.id });
    await createConversation({ phone: '11000010071', leadId: leadBa.id });
    await createConversation({ phone: '11000010072', leadId: leadNull.id });

    const rs = await request(app).get('/api/conversations?uf=RS').set('Authorization', `Bearer ${token}`);
    expect(rs.status).toBe(200);
    const rsPhones = rs.body.items.map((c: { phone: string }) => c.phone);
    expect(rsPhones).toContain('11000010070'); // RS
    expect(rsPhones).toContain('11000010072'); // null → conta como RS
    expect(rsPhones).not.toContain('11000010071'); // BA fora

    const ba = await request(app).get('/api/conversations?uf=BA').set('Authorization', `Bearer ${token}`);
    const baPhones = ba.body.items.map((c: { phone: string }) => c.phone);
    expect(baPhones).toContain('11000010071'); // BA
    expect(baPhones).not.toContain('11000010070'); // RS fora
    expect(baPhones).not.toContain('11000010072'); // null fora
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
    expect(res.body).toEqual({ ia: 0, recepcao: 1, comercial: 1, unread: 0, awaitingUs: 0 });
  });

  it('unread conta conversas com não-lidas (não encerradas)', async () => {
    const token = await seedAuth();
    const l1 = await createLead({ phone: '11000020010' });
    await createConversation({ phone: '11000020010', leadId: l1.id, queue: 'recepcao', unreadCount: 3 });
    const l2 = await createLead({ phone: '11000020011' });
    await createConversation({ phone: '11000020011', leadId: l2.id, queue: 'comercial', unreadCount: 0 });
    const l3 = await createLead({ phone: '11000020012' });
    await createConversation({ phone: '11000020012', leadId: l3.id, queue: 'recepcao', unreadCount: 5, status: 'encerrada' });

    const res = await request(app).get('/api/conversations/counts').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    // Só a conversa não-lida e não-encerrada conta (a encerrada com unread não).
    expect(res.body.unread).toBe(1);
  });
});
