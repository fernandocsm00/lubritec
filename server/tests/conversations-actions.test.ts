import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { db } from '../db/client';
import { conversations } from '../db/schema';
import { eq } from 'drizzle-orm';
import { createUser, createLead, createConversation, createMessage } from './helpers';

const app = createApp();

async function loginAs(email = 'r@x.com', password = 'pw12345') {
  await createUser({ email, password, role: 'recepcao' });
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return { token: res.body.accessToken as string, userId: res.body.user.id as string };
}

describe('POST /api/conversations/:id/claim', () => {
  it('401 sem token', async () => {
    const res = await request(app).post('/api/conversations/00000000-0000-0000-0000-000000000000/claim');
    expect(res.status).toBe(401);
  });

  it('404 quando id não existe', async () => {
    const { token } = await loginAs();
    const res = await request(app)
      .post('/api/conversations/00000000-0000-0000-0000-000000000000/claim')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('200 atribui usuário e muda status pra em_atendimento', async () => {
    const { token, userId } = await loginAs();
    const lead = await createLead({ phone: '11000040001' });
    const conv = await createConversation({ phone: '11000040001', leadId: lead.id });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/claim`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.assignedTo.id).toBe(userId);
    expect(res.body.status).toBe('em_atendimento');

    const [row] = await db.select().from(conversations).where(eq(conversations.id, conv.id));
    expect(row.assignedTo).toBe(userId);
  });

  it('idempotente — pegar 2x não dá erro', async () => {
    const { token } = await loginAs();
    const lead = await createLead({ phone: '11000040002' });
    const conv = await createConversation({ phone: '11000040002', leadId: lead.id });

    await request(app).post(`/api/conversations/${conv.id}/claim`).set('Authorization', `Bearer ${token}`);
    const res = await request(app).post(`/api/conversations/${conv.id}/claim`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});

describe('POST /api/conversations/:id/assign', () => {
  it('401 sem token', async () => {
    const res = await request(app)
      .post('/api/conversations/00000000-0000-0000-0000-000000000000/assign')
      .send({ userId: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBe(401);
  });

  it('atribui a outra pessoa, seta em_atendimento e assigned_to', async () => {
    const { token } = await loginAs('mgr@x.com', 'pw12345');
    const target = await createUser({ email: 'target@x.com', password: 'pw12345', role: 'comercial' });
    const lead = await createLead({ phone: '11000045001' });
    const conv = await createConversation({ phone: '11000045001', leadId: lead.id });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: target.id });
    expect(res.status).toBe(200);
    expect(res.body.assignedTo.id).toBe(target.id);
    expect(res.body.status).toBe('em_atendimento');

    const [row] = await db.select().from(conversations).where(eq(conversations.id, conv.id));
    expect(row.assignedTo).toBe(target.id);
  });

  it('desatribui com userId=null e volta a aguardando_atendimento', async () => {
    const { token, userId } = await loginAs('mgr2@x.com', 'pw12345');
    const lead = await createLead({ phone: '11000045002' });
    const conv = await createConversation({
      phone: '11000045002', leadId: lead.id, assignedTo: userId, status: 'em_atendimento',
    });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: null });
    expect(res.status).toBe(200);
    expect(res.body.assignedTo).toBeNull();
    expect(res.body.status).toBe('aguardando_atendimento');
  });

  it('404 quando target user nao existe', async () => {
    const { token } = await loginAs('mgr3@x.com', 'pw12345');
    const lead = await createLead({ phone: '11000045003' });
    const conv = await createConversation({ phone: '11000045003', leadId: lead.id });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBe(404);
  });

  it('preserva status encerrada ao reatribuir', async () => {
    const { token } = await loginAs('mgr4@x.com', 'pw12345');
    const target = await createUser({ email: 'target2@x.com', password: 'pw12345', role: 'comercial' });
    const lead = await createLead({ phone: '11000045004' });
    const conv = await createConversation({
      phone: '11000045004', leadId: lead.id, status: 'encerrada',
    });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: target.id });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('encerrada');
    expect(res.body.assignedTo.id).toBe(target.id);
  });
});

describe('POST /api/conversations/:id/queue', () => {
  it('200 muda fila', async () => {
    const { token } = await loginAs();
    const lead = await createLead({ phone: '11000041001' });
    const conv = await createConversation({ phone: '11000041001', leadId: lead.id, queue: 'recepcao' });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/queue`)
      .set('Authorization', `Bearer ${token}`)
      .send({ queue: 'comercial' });
    expect(res.status).toBe(200);
    expect(res.body.queue).toBe('comercial');
  });

  it('400 quando fila inválida', async () => {
    const { token } = await loginAs();
    const lead = await createLead({ phone: '11000041002' });
    const conv = await createConversation({ phone: '11000041002', leadId: lead.id });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/queue`)
      .set('Authorization', `Bearer ${token}`)
      .send({ queue: 'invalida' });
    expect(res.status).toBe(400);
  });

  it('move pra ia com inbound nao respondido seta pending_ai_response', async () => {
    const { token } = await loginAs();
    const lead = await createLead({ phone: '11000041003' });
    const conv = await createConversation({ phone: '11000041003', leadId: lead.id, queue: 'comercial' });
    await createMessage({ conversationId: conv.id, direction: 'in', body: 'Oi' });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/queue`)
      .set('Authorization', `Bearer ${token}`)
      .send({ queue: 'ia' });
    expect(res.status).toBe(200);

    const [row] = await db.select().from(conversations).where(eq(conversations.id, conv.id));
    expect(row.queue).toBe('ia');
    expect(row.pendingAiResponse).toBe(true);
  });

  it('move pra ia com ultima msg outbound NAO seta pending_ai_response', async () => {
    const { token } = await loginAs();
    const lead = await createLead({ phone: '11000041004' });
    const conv = await createConversation({ phone: '11000041004', leadId: lead.id, queue: 'comercial' });
    await createMessage({ conversationId: conv.id, direction: 'in', body: 'Oi', sentAt: new Date(Date.now() - 1000) });
    await createMessage({ conversationId: conv.id, direction: 'out', body: 'Resposta', sentAt: new Date() });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/queue`)
      .set('Authorization', `Bearer ${token}`)
      .send({ queue: 'ia' });
    expect(res.status).toBe(200);

    const [row] = await db.select().from(conversations).where(eq(conversations.id, conv.id));
    expect(row.pendingAiResponse).toBe(false);
  });

  it('move pra fila NAO-ia nunca seta pending_ai_response', async () => {
    const { token } = await loginAs();
    const lead = await createLead({ phone: '11000041005' });
    const conv = await createConversation({ phone: '11000041005', leadId: lead.id, queue: 'ia' });
    await createMessage({ conversationId: conv.id, direction: 'in', body: 'Oi' });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/queue`)
      .set('Authorization', `Bearer ${token}`)
      .send({ queue: 'recepcao' });
    expect(res.status).toBe(200);

    const [row] = await db.select().from(conversations).where(eq(conversations.id, conv.id));
    expect(row.queue).toBe('recepcao');
    expect(row.pendingAiResponse).toBe(false);
  });
});

describe('POST /api/conversations/:id/close', () => {
  it('200 muda status pra encerrada', async () => {
    const { token } = await loginAs();
    const lead = await createLead({ phone: '11000042001' });
    const conv = await createConversation({ phone: '11000042001', leadId: lead.id, status: 'em_atendimento' });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/close`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('encerrada');
  });
});

describe('POST /api/conversations/:id/read', () => {
  it('200 zera unread_count', async () => {
    const { token } = await loginAs();
    const lead = await createLead({ phone: '11000043001' });
    const conv = await createConversation({
      phone: '11000043001',
      leadId: lead.id,
      unreadCount: 5,
    });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/read`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);

    const [row] = await db.select().from(conversations).where(eq(conversations.id, conv.id));
    expect(row.unreadCount).toBe(0);
  });
});

// Regressao: getConversationById varria a PAGINA 1 da listagem (PAGE_SIZE=50,
// ordenada por last_message_at desc) procurando o id. Conversa fora das 50 mais
// recentes -> 404, mesmo existindo. Como todas as acoes gravam ANTES de chamar
// loadAndReturn, a escrita acontecia e o front mostrava "Falha ao mover".
describe('acoes em conversa fora da primeira pagina da listagem', () => {
  async function seedBeyondFirstPage() {
    const lead = await createLead({ phone: '11000044001' });
    // Alvo com last_message_at antigo -> vai pro fim da ordenacao.
    const alvo = await createConversation({
      phone: '11000044001',
      leadId: lead.id,
      queue: 'recepcao',
      lastMessageAt: new Date('2020-01-01T00:00:00Z'),
    });
    // 55 conversas mais recentes empurram o alvo pra alem da pagina 1 (50).
    for (let i = 0; i < 55; i++) {
      const l = await createLead({ phone: `1100004${String(5000 + i).padStart(4, '0')}` });
      await createConversation({
        leadId: l.id,
        lastMessageAt: new Date(Date.now() - i * 1000),
      });
    }
    return alvo;
  }

  it('move a fila e devolve 200 (nao 404)', async () => {
    const { token } = await loginAs();
    const alvo = await seedBeyondFirstPage();

    const res = await request(app)
      .post(`/api/conversations/${alvo.id}/queue`)
      .set('Authorization', `Bearer ${token}`)
      .send({ queue: 'comercial' });

    expect(res.status).toBe(200);
    expect(res.body.queue).toBe('comercial');
  });

  it('GET detalhe devolve 200 (nao 404)', async () => {
    const { token } = await loginAs();
    const alvo = await seedBeyondFirstPage();

    const res = await request(app)
      .get(`/api/conversations/${alvo.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(alvo.id);
  });

  it('404 continua valendo pra id inexistente', async () => {
    const { token } = await loginAs();
    const res = await request(app)
      .get('/api/conversations/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

// Regressao: changeQueue setava queue='ia' e pending_ai_response=true mas NAO
// limpava ai_disabled. O aiPendingWorker filtra por ai_disabled=false, entao a
// conversa movida pra IA nunca era processada — o "Mover pra IA" nao devolvia
// a conversa pra IA, em silencio. O botao "IA on" (setConversationAi) sempre
// limpou o flag; os dois caminhos discordavam.
describe('POST /api/conversations/:id/queue — freio da IA', () => {
  it('mover pra ia religa a IA (limpa ai_disabled)', async () => {
    const { token } = await loginAs();
    const lead = await createLead({ phone: '11000046001' });
    const conv = await createConversation({
      phone: '11000046001',
      leadId: lead.id,
      queue: 'recepcao',
      aiDisabled: true,
    });
    await createMessage({ conversationId: conv.id, direction: 'in', body: 'Oi' });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/queue`)
      .set('Authorization', `Bearer ${token}`)
      .send({ queue: 'ia' });
    expect(res.status).toBe(200);

    const [row] = await db.select().from(conversations).where(eq(conversations.id, conv.id));
    expect(row.queue).toBe('ia');
    expect(row.aiDisabled).toBe(false);
    expect(row.pendingAiResponse).toBe(true);
  });

  it('mover pra comercial NAO religa a IA', async () => {
    const { token } = await loginAs();
    const lead = await createLead({ phone: '11000046002' });
    const conv = await createConversation({
      phone: '11000046002',
      leadId: lead.id,
      queue: 'recepcao',
      aiDisabled: true,
    });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/queue`)
      .set('Authorization', `Bearer ${token}`)
      .send({ queue: 'comercial' });
    expect(res.status).toBe(200);

    const [row] = await db.select().from(conversations).where(eq(conversations.id, conv.id));
    expect(row.aiDisabled).toBe(true);
  });
});
