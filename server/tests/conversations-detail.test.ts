import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { createUser, createLead, createConversation, createMessage } from './helpers';

const app = createApp();

async function loginAs(email = 'r@x.com', password = 'pw12345') {
  await createUser({ email, password, role: 'recepcao' });
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return res.body.accessToken as string;
}

describe('GET /api/conversations/:id/messages', () => {
  it('401 sem token', async () => {
    const res = await request(app).get('/api/conversations/00000000-0000-0000-0000-000000000000/messages');
    expect(res.status).toBe(401);
  });

  it('404 quando id não existe', async () => {
    const token = await loginAs();
    const res = await request(app)
      .get('/api/conversations/00000000-0000-0000-0000-000000000000/messages')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('200 retorna mensagens ordenadas DESC', async () => {
    const token = await loginAs();
    const lead = await createLead({ phone: '11000030001' });
    const conv = await createConversation({ phone: '11000030001', leadId: lead.id });
    await createMessage({
      conversationId: conv.id,
      body: 'primeira',
      sentAt: new Date('2026-05-01T10:00:00Z'),
    });
    await createMessage({
      conversationId: conv.id,
      body: 'segunda',
      sentAt: new Date('2026-05-01T10:05:00Z'),
    });

    const res = await request(app)
      .get(`/api/conversations/${conv.id}/messages`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0].body).toBe('segunda');
    expect(res.body.items[1].body).toBe('primeira');
    expect(res.body.hasMore).toBe(false);
  });

  it('paginação: before retorna mensagens anteriores ao timestamp', async () => {
    const token = await loginAs();
    const lead = await createLead({ phone: '11000030010' });
    const conv = await createConversation({ phone: '11000030010', leadId: lead.id });
    await createMessage({
      conversationId: conv.id,
      body: 'antiga',
      sentAt: new Date('2026-05-01T08:00:00Z'),
    });
    await createMessage({
      conversationId: conv.id,
      body: 'recente',
      sentAt: new Date('2026-05-01T12:00:00Z'),
    });

    const res = await request(app)
      .get(`/api/conversations/${conv.id}/messages?before=2026-05-01T10:00:00.000Z`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].body).toBe('antiga');
  });
});
