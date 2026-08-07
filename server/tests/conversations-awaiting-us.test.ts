import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { createUser, createLead, createConversation } from './helpers';

const app = createApp();

async function loginAs(email = 'c@x.com', password = 'pw12345') {
  await createUser({ email, password, role: 'comercial' });
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return res.body.accessToken as string;
}

let seq = 0;
async function conv(opts: {
  lastInboundAt: Date;
  lastMessageAt: Date;
  queue?: 'comercial' | 'ia' | 'recepcao';
  aiDisabled?: boolean;
}) {
  seq += 1;
  const phone = `5511950${String(100000 + seq).slice(-6)}`;
  const lead = await createLead({ phone });
  return createConversation({
    phone,
    leadId: lead.id,
    queue: opts.queue ?? 'comercial',
    status: 'em_atendimento',
    lastInboundAt: opts.lastInboundAt,
    lastMessageAt: opts.lastMessageAt,
    aiDisabled: opts.aiDisabled,
  });
}

describe('GET /api/conversations?awaitingUs=true', () => {
  it('retorna só as conversas em que devemos resposta', async () => {
    const token = await loginAs();
    const esperando = await conv({
      lastInboundAt: new Date('2026-08-05T12:00:00Z'),
      lastMessageAt: new Date('2026-08-05T12:00:00Z'),
    });
    await conv({
      lastInboundAt: new Date('2026-08-05T12:00:00Z'),
      lastMessageAt: new Date('2026-08-05T12:30:00Z'), // já respondida
    });

    const res = await request(app)
      .get('/api/conversations?awaitingUs=true')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.items.map((c: { id: string }) => c.id)).toEqual([esperando.id]);
  });

  it('awaitingUsMinutes é null quando a bola está com o lead', async () => {
    const token = await loginAs('c2@x.com');
    const respondida = await conv({
      lastInboundAt: new Date('2026-08-05T12:00:00Z'),
      lastMessageAt: new Date('2026-08-05T12:30:00Z'),
    });

    const res = await request(app)
      .get('/api/conversations')
      .set('Authorization', `Bearer ${token}`);

    const item = res.body.items.find((c: { id: string }) => c.id === respondida.id);
    expect(item.awaitingUsMinutes).toBeNull();
  });

  it('awaitingUsMinutes conta minutos comerciais, não corridos', async () => {
    const token = await loginAs('c3@x.com');
    // 2026-08-05 é quarta. Inbound às 02:00 BRT (05:00Z), madrugada: o relógio
    // só começa às 08:00 BRT. Com o default 08-18 o valor tem que ser MENOR que
    // o tempo corrido desde as 02:00.
    const madrugada = await conv({
      lastInboundAt: new Date('2026-08-05T05:00:00Z'),
      lastMessageAt: new Date('2026-08-05T05:00:00Z'),
    });

    const res = await request(app)
      .get('/api/conversations?awaitingUs=true')
      .set('Authorization', `Bearer ${token}`);

    const item = res.body.items.find((c: { id: string }) => c.id === madrugada.id);
    const corridoMin = (Date.now() - Date.parse('2026-08-05T05:00:00Z')) / 60_000;
    expect(item.awaitingUsMinutes).toBeGreaterThan(0);
    expect(item.awaitingUsMinutes).toBeLessThan(corridoMin);
  });

  it('com o filtro ativo, ordena do que espera há mais tempo pro mais recente', async () => {
    const token = await loginAs('c5@x.com');
    const recente = await conv({
      lastInboundAt: new Date('2026-08-05T16:00:00Z'),
      lastMessageAt: new Date('2026-08-05T16:00:00Z'),
    });
    const antiga = await conv({
      lastInboundAt: new Date('2026-08-05T09:00:00Z'),
      lastMessageAt: new Date('2026-08-05T09:00:00Z'),
    });

    const res = await request(app)
      .get('/api/conversations?awaitingUs=true')
      .set('Authorization', `Bearer ${token}`);

    const ids = res.body.items.map((c: { id: string }) => c.id);
    expect(ids.indexOf(antiga.id)).toBeLessThan(ids.indexOf(recente.id));
  });

  it('counts devolve awaitingUs coerente com a lista', async () => {
    const token = await loginAs('c4@x.com');
    await conv({
      lastInboundAt: new Date('2026-08-05T12:00:00Z'),
      lastMessageAt: new Date('2026-08-05T12:00:00Z'),
    });

    const lista = await request(app)
      .get('/api/conversations?awaitingUs=true')
      .set('Authorization', `Bearer ${token}`);
    const counts = await request(app)
      .get('/api/conversations/counts')
      .set('Authorization', `Bearer ${token}`);

    expect(counts.body.awaitingUs).toBe(lista.body.total);
  });

  it('fila ia com IA ligada: awaitingUsMinutes é null (a IA responde, não nós)', async () => {
    const token = await loginAs('c6@x.com');
    const naFilaIa = await conv({
      lastInboundAt: new Date('2026-08-05T12:00:00Z'),
      lastMessageAt: new Date('2026-08-05T12:00:00Z'),
      queue: 'ia',
      aiDisabled: false,
    });

    const res = await request(app)
      .get('/api/conversations')
      .set('Authorization', `Bearer ${token}`);

    const item = res.body.items.find((c: { id: string }) => c.id === naFilaIa.id);
    expect(item.awaitingUsMinutes).toBeNull();
  });

  it('fila recepcao com IA desligada na conversa: awaitingUsMinutes é um número', async () => {
    const token = await loginAs('c7@x.com');
    const recepcaoSemIa = await conv({
      lastInboundAt: new Date('2026-08-05T12:00:00Z'),
      lastMessageAt: new Date('2026-08-05T12:00:00Z'),
      queue: 'recepcao',
      aiDisabled: true,
    });

    const res = await request(app)
      .get('/api/conversations')
      .set('Authorization', `Bearer ${token}`);

    const item = res.body.items.find((c: { id: string }) => c.id === recepcaoSemIa.id);
    expect(typeof item.awaitingUsMinutes).toBe('number');
  });
});
