import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { createUser, createLead, createConversation } from './helpers';
import { db } from '../db/client';
import { conversations } from '../db/schema';
import { eq } from 'drizzle-orm';

const app = createApp();
const MIN = 60 * 1000;

async function loginAdmin(email: string) {
  await createUser({ email, password: 'pw12345', role: 'admin' });
  const res = await request(app).post('/api/auth/login').send({ email, password: 'pw12345' });
  return res.body.accessToken as string;
}

/** Cria conversa no Comercial com lastMessageAt e entered_queue_at distintos. */
async function convAt(opts: { name: string; lastMessageAt: Date; enteredQueueAt: Date; lastInboundAt?: Date }) {
  const lead = await createLead({ name: opts.name });
  const c = await createConversation({
    leadId: lead.id,
    queue: 'comercial',
    originKind: 'organic',
    lastMessageAt: opts.lastMessageAt,
    lastInboundAt: opts.lastInboundAt ?? opts.lastMessageAt,
  });
  await db.update(conversations)
    .set({ enteredQueueAt: opts.enteredQueueAt })
    .where(eq(conversations.id, c.id));
  return c;
}

describe('ordenação da Inbox', () => {
  it('fila Comercial vem da interação mais recente para a mais antiga', async () => {
    // entered_queue_at é montado na ORDEM INVERSA de propósito: se a lista
    // ainda estivesse ordenando por FIFO de entrada na fila, este teste falha.
    const token = await loginAdmin('ord1@x.com');
    const now = Date.now();
    // FIFO por entered_queue_at daria [Antiga, Media, Recente] — o INVERSO do
    // esperado. É isso que faz o teste falhar contra a ordenação antiga.
    await convAt({ name: 'Antiga',  lastMessageAt: new Date(now - 300 * MIN), enteredQueueAt: new Date(now - 300 * MIN) });
    await convAt({ name: 'Media',   lastMessageAt: new Date(now - 60 * MIN),  enteredQueueAt: new Date(now - 200 * MIN) });
    await convAt({ name: 'Recente', lastMessageAt: new Date(now - 5 * MIN),   enteredQueueAt: new Date(now - 100 * MIN) });

    const res = await request(app)
      .get('/api/conversations?queue=comercial')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const nomes = res.body.items.map((c: { lead: { name: string } }) => c.lead.name);
    expect(nomes.slice(0, 3)).toEqual(['Recente', 'Media', 'Antiga']);
  });

  it('"Aguardando nós" continua priorizando quem espera há mais tempo', async () => {
    // Esta ordenação é o propósito do chip: inverter aqui o esvaziaria de
    // sentido, então a mudança de ordem do Comercial não pode alcançá-lo.
    const token = await loginAdmin('ord2@x.com');
    const now = Date.now();
    await convAt({
      name: 'EsperaPouco', lastMessageAt: new Date(now - 5 * MIN),
      enteredQueueAt: new Date(now - 5 * MIN), lastInboundAt: new Date(now - 5 * MIN),
    });
    await convAt({
      name: 'EsperaMuito', lastMessageAt: new Date(now - 200 * MIN),
      enteredQueueAt: new Date(now - 200 * MIN), lastInboundAt: new Date(now - 200 * MIN),
    });

    const res = await request(app)
      .get('/api/conversations?queue=comercial&awaitingUs=true')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const nomes = res.body.items.map((c: { lead: { name: string } }) => c.lead.name);
    expect(nomes.indexOf('EsperaMuito')).toBeLessThan(nomes.indexOf('EsperaPouco'));
  });
});
