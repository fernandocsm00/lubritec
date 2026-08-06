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

  it('paginação não pula mensagem quando a borda da página cai em timestamps iguais', async () => {
    // O webhook grava lotes inteiros no MESMO segundo (um cliente mandou 6
    // documentos em 18:47:4x). Se a fronteira da página cair no meio de um
    // lote desses, um cursor que compara só o timestamp com "<" pula as irmãs
    // que ficaram do lado de fora — e elas somem da conversa pra sempre, que é
    // exatamente o sintoma que a paginação deveria estar consertando.
    const token = await loginAs();
    const lead = await createLead({ phone: '11000030011' });
    const conv = await createConversation({ phone: '11000030011', leadId: lead.id });

    const base = Date.parse('2026-05-01T10:00:00Z');
    const criadas: string[] = [];
    for (let i = 0; i < 52; i += 1) {
      // Índices 1, 2 e 3 no mesmo instante: com PAGE_SIZE 50 a borda cai
      // dentro desse trio, deixando um irmão fora da primeira página.
      const minuto = i >= 1 && i <= 3 ? 1 : i;
      const m = await createMessage({
        conversationId: conv.id,
        body: `msg-${i}`,
        sentAt: new Date(base + minuto * 60_000),
      });
      criadas.push(m.id);
    }

    const primeira = await request(app)
      .get(`/api/conversations/${conv.id}/messages`)
      .set('Authorization', `Bearer ${token}`);
    expect(primeira.body.items).toHaveLength(50);
    expect(primeira.body.hasMore).toBe(true);

    const ultima = primeira.body.items[primeira.body.items.length - 1];
    const segunda = await request(app)
      .get(`/api/conversations/${conv.id}/messages?before=${encodeURIComponent(ultima.sentAt)}&beforeId=${ultima.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(segunda.status).toBe(200);

    const vistos = new Set<string>([
      ...primeira.body.items.map((m: { id: string }) => m.id),
      ...segunda.body.items.map((m: { id: string }) => m.id),
    ]);
    const perdidas = criadas.filter((id) => !vistos.has(id));
    expect(perdidas).toEqual([]);
  });

  it('ordena de forma estável quando várias mensagens têm o mesmo timestamp', async () => {
    // Sem desempate a ordem entre irmãs do mesmo segundo é indefinida: o
    // polling de 5s reordena as bolhas sozinho e elas piscam de lugar.
    const token = await loginAs();
    const lead = await createLead({ phone: '11000030012' });
    const conv = await createConversation({ phone: '11000030012', leadId: lead.id });
    const instante = new Date('2026-05-01T18:47:44Z');
    for (let i = 0; i < 6; i += 1) {
      await createMessage({ conversationId: conv.id, body: `lote-${i}`, sentAt: instante });
    }

    const url = `/api/conversations/${conv.id}/messages`;
    const a = await request(app).get(url).set('Authorization', `Bearer ${token}`);
    const b = await request(app).get(url).set('Authorization', `Bearer ${token}`);

    expect(a.body.items.map((m: { id: string }) => m.id))
      .toEqual(b.body.items.map((m: { id: string }) => m.id));
  });
});
