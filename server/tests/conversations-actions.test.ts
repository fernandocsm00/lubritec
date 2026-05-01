import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { db } from '../db/client';
import { conversations } from '../db/schema';
import { eq } from 'drizzle-orm';
import { createUser, createLead, createConversation } from './helpers';

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
