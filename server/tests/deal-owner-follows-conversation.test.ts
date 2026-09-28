import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { and, eq } from 'drizzle-orm';
import { db, pool } from '../db/client';
import { dealActivities, deals } from '../db/schema';
import {
  createUser,
  createLead,
  createConversation,
  createDeal,
  createWhatsappInstance,
  createHsmTemplate,
} from './helpers';

// O card do Inside Sales segue o dono da conversa. Caso real (25/09/2026): a IA
// qualificou o Samuel às 09:44 e criou o card sem dono; às 09:51 a Julia
// respondeu e a conversa virou dela, mas o card continuou "Sem dono" — dono da
// conversa (conversations.assigned_to) e dono do card (deals.owner_user_id)
// eram dois campos sem ligação nenhuma.
const { fakeProvider } = vi.hoisted(() => ({
  fakeProvider: {
    kind: 'uazapi' as 'uazapi' | 'meta_cloud',
    sendText: vi.fn(),
    sendMedia: vi.fn(),
    sendTemplate: vi.fn(),
  },
}));

vi.mock('../services/whatsapp/providerRegistry', async (orig) => {
  const actual = await orig<typeof import('../services/whatsapp/providerRegistry')>();
  return { ...actual, resolveProvider: vi.fn(async () => fakeProvider) };
});

import { createApp } from '../app';

const app = createApp();

async function login(email: string, name: string) {
  await createUser({ email, name, password: 'pw12345', role: 'comercial' });
  const res = await request(app).post('/api/auth/login').send({ email, password: 'pw12345' });
  return { token: res.body.accessToken as string, userId: res.body.user.id as string };
}

async function dealOwner(dealId: string) {
  const [row] = await db.select({ ownerUserId: deals.ownerUserId }).from(deals).where(eq(deals.id, dealId));
  return row.ownerUserId;
}

beforeEach(() => {
  fakeProvider.kind = 'uazapi';
  fakeProvider.sendText.mockReset().mockResolvedValue({ providerMsgId: 'p-text-1', rawPayload: {} });
  fakeProvider.sendMedia.mockReset().mockResolvedValue({ providerMsgId: 'p-media-1', rawPayload: {} });
  fakeProvider.sendTemplate.mockReset().mockResolvedValue({ providerMsgId: 'p-tpl-1', rawPayload: {} });
});

describe('card do Inside Sales segue o dono da conversa', () => {
  it('primeira resposta de quem atende: card sem dono passa a ser dela (caso Samuel)', async () => {
    const julia = await login('julia@x.com', 'Julia Bacchi');
    const lead = await createLead({ phone: '5554991921858', name: 'Samuel' });
    const conv = await createConversation({ phone: '5554991921858', leadId: lead.id, queue: 'comercial' });
    const deal = await createDeal({ leadId: lead.id, stage: 'lead_no_comercial', ownerUserId: null });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/messages`)
      .set('Authorization', `Bearer ${julia.token}`)
      .send({ kind: 'text', body: 'Olá Samuel, meu nome é Júlia.' });
    expect(res.status).toBe(200);

    expect(await dealOwner(deal.id)).toBe(julia.userId);
    // Fica registrado no histórico do card, com quem fez e por quê.
    const acts = await db.select().from(dealActivities)
      .where(and(eq(dealActivities.dealId, deal.id), eq(dealActivities.kind, 'owner_changed')));
    expect(acts).toHaveLength(1);
    expect(acts[0].actorUserId).toBe(julia.userId);
    expect(acts[0].metadata).toMatchObject({ fromUserId: null, toUserId: julia.userId, via: 'conversation' });
  });

  it('conversa que já era da Julia com card sem dono: qualquer resposta preenche o card', async () => {
    const julia = await login('julia@x.com', 'Julia Bacchi');
    const pedro = await login('pedro@x.com', 'Pedro');
    const lead = await createLead({ phone: '5554991921859' });
    const conv = await createConversation({
      phone: '5554991921859', leadId: lead.id, queue: 'comercial',
      assignedTo: julia.userId, status: 'em_atendimento',
    });
    const deal = await createDeal({ leadId: lead.id, stage: 'lead_no_comercial', ownerUserId: null });

    // Pedro responde na conversa da Julia: a conversa continua da Julia, e o card vai pra ela.
    const res = await request(app)
      .post(`/api/conversations/${conv.id}/messages`)
      .set('Authorization', `Bearer ${pedro.token}`)
      .send({ kind: 'text', body: 'cobrindo a Julia' });
    expect(res.status).toBe(200);

    expect(await dealOwner(deal.id)).toBe(julia.userId);
  });

  it('"Reatribuir a mim" leva o card junto', async () => {
    const julia = await login('julia@x.com', 'Julia Bacchi');
    const pedro = await login('pedro@x.com', 'Pedro');
    const lead = await createLead({ phone: '5554991921860' });
    const conv = await createConversation({
      phone: '5554991921860', leadId: lead.id, queue: 'comercial',
      assignedTo: julia.userId, status: 'em_atendimento',
    });
    const deal = await createDeal({ leadId: lead.id, stage: 'em_negociacao', ownerUserId: julia.userId });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/claim`)
      .set('Authorization', `Bearer ${pedro.token}`);
    expect(res.status).toBe(200);

    expect(await dealOwner(deal.id)).toBe(pedro.userId);
  });

  it('"Atribuir" a outra pessoa leva o card junto', async () => {
    const gerente = await login('gerente@x.com', 'Gerente');
    const julia = await login('julia@x.com', 'Julia Bacchi');
    const lead = await createLead({ phone: '5554991921861' });
    const conv = await createConversation({ phone: '5554991921861', leadId: lead.id, queue: 'comercial' });
    const deal = await createDeal({ leadId: lead.id, stage: 'lead_no_comercial', ownerUserId: null });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/assign`)
      .set('Authorization', `Bearer ${gerente.token}`)
      .send({ userId: julia.userId });
    expect(res.status).toBe(200);

    expect(await dealOwner(deal.id)).toBe(julia.userId);
    const [act] = await db.select().from(dealActivities)
      .where(and(eq(dealActivities.dealId, deal.id), eq(dealActivities.kind, 'owner_changed')));
    expect(act.actorUserId).toBe(gerente.userId);
  });

  it('card dado a outra pessoa direto no Inside Sales não é mexido', async () => {
    const gerente = await login('gerente@x.com', 'Gerente');
    const julia = await login('julia@x.com', 'Julia Bacchi');
    const pedro = await login('pedro@x.com', 'Pedro');
    const carla = await login('carla@x.com', 'Carla');
    const lead = await createLead({ phone: '5554991921862' });
    const conv = await createConversation({
      phone: '5554991921862', leadId: lead.id, queue: 'comercial',
      assignedTo: julia.userId, status: 'em_atendimento',
    });
    // Conversa da Julia, mas o card foi entregue à Carla no pipeline: escolha deliberada.
    const deal = await createDeal({ leadId: lead.id, stage: 'em_negociacao', ownerUserId: carla.userId });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/assign`)
      .set('Authorization', `Bearer ${gerente.token}`)
      .send({ userId: pedro.userId });
    expect(res.status).toBe(200);

    expect(await dealOwner(deal.id)).toBe(carla.userId);
  });

  it('card puxado no pipeline antes de a conversa ter dono também é respeitado', async () => {
    const julia = await login('julia@x.com', 'Julia Bacchi');
    const carla = await login('carla@x.com', 'Carla');
    const lead = await createLead({ phone: '5554991921863' });
    const conv = await createConversation({ phone: '5554991921863', leadId: lead.id, queue: 'comercial' });
    const deal = await createDeal({ leadId: lead.id, stage: 'lead_no_comercial', ownerUserId: carla.userId });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/claim`)
      .set('Authorization', `Bearer ${julia.token}`);
    expect(res.status).toBe(200);

    expect(await dealOwner(deal.id)).toBe(carla.userId);
  });

  it('tirar o dono da conversa não tira o dono do card', async () => {
    const julia = await login('julia@x.com', 'Julia Bacchi');
    const lead = await createLead({ phone: '5554991921864' });
    const conv = await createConversation({
      phone: '5554991921864', leadId: lead.id, queue: 'comercial',
      assignedTo: julia.userId, status: 'em_atendimento',
    });
    const deal = await createDeal({ leadId: lead.id, stage: 'em_negociacao', ownerUserId: julia.userId });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/assign`)
      .set('Authorization', `Bearer ${julia.token}`)
      .send({ userId: null });
    expect(res.status).toBe(200);

    expect(await dealOwner(deal.id)).toBe(julia.userId);
  });

  it('card fechado (ganho/perdido) nunca muda de dono', async () => {
    const julia = await login('julia@x.com', 'Julia Bacchi');
    const pedro = await login('pedro@x.com', 'Pedro');
    const lead = await createLead({ phone: '5554991921865' });
    const conv = await createConversation({
      phone: '5554991921865', leadId: lead.id, queue: 'comercial',
      assignedTo: julia.userId, status: 'em_atendimento',
    });
    const ganho = await createDeal({
      leadId: lead.id, stage: 'ganho', proposalValue: 1000, ownerUserId: julia.userId, closedAt: new Date(),
    });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/claim`)
      .set('Authorization', `Bearer ${pedro.token}`);
    expect(res.status).toBe(200);

    expect(await dealOwner(ganho.id)).toBe(julia.userId);
  });

  it('template enviado pelo chat (linha oficial) também leva o card junto', async () => {
    fakeProvider.kind = 'meta_cloud';
    const julia = await login('julia@x.com', 'Julia Bacchi');
    const meta = await createWhatsappInstance({ provider: 'meta_cloud', displayName: 'Oficial' });
    const lead = await createLead({ phone: '5554991921866', name: 'Samuel' });
    const conv = await createConversation({
      phone: '5554991921866', leadId: lead.id, instanceId: meta.id, queue: 'comercial',
      lastInboundAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
    });
    const deal = await createDeal({ leadId: lead.id, stage: 'lead_no_comercial', ownerUserId: null });
    const tpl = await createHsmTemplate({
      instanceId: meta.id,
      createdBy: julia.userId,
      name: 'retomada_cotacao_simples',
      status: 'APPROVED',
      category: 'UTILITY',
      components: [{ type: 'BODY', text: 'Olá! Aqui é da Lubritec.' }],
      variableCount: 0,
    });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/template`)
      .set('Authorization', `Bearer ${julia.token}`)
      .send({ hsmTemplateId: tpl.id, hsmVariables: [] });
    expect(res.status).toBe(200);

    expect(await dealOwner(deal.id)).toBe(julia.userId);
  });
});

describe('migration 047 — cards sem dono herdam o dono da conversa', () => {
  const MIGRATION = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../db/migrations/047_deal_owner_from_conversation.sql',
  );

  it('preenche só card aberto e sem dono, com o dono da conversa mais recente', async () => {
    const julia = await createUser({ email: 'julia@x.com', name: 'Julia Bacchi' });
    const pedro = await createUser({ email: 'pedro@x.com', name: 'Pedro' });
    const carla = await createUser({ email: 'carla@x.com', name: 'Carla' });

    // Caso Samuel: card aberto sem dono, conversa da Julia.
    const samuel = await createLead({ phone: '5554991921870' });
    await createConversation({
      phone: '5554991921870', leadId: samuel.id, assignedTo: julia.id,
      lastMessageAt: new Date('2026-09-25T12:51:00Z'),
    });
    const semDono = await createDeal({
      leadId: samuel.id, stage: 'lead_no_comercial', ownerUserId: null,
      createdAt: new Date('2026-09-25T12:44:00Z'), updatedAt: new Date('2026-09-25T12:44:00Z'),
    });

    // Lead com duas linhas: vale o dono da conversa mais recente.
    const duasLinhas = await createLead({ phone: '5554991921871' });
    const outraLinha = await createWhatsappInstance({ provider: 'uazapi', displayName: 'Fixo' });
    await createConversation({
      phone: '5554991921871', leadId: duasLinhas.id, assignedTo: carla.id,
      lastMessageAt: new Date('2026-09-20T12:00:00Z'),
    });
    await createConversation({
      phone: '5554991921871', leadId: duasLinhas.id, instanceId: outraLinha.id, assignedTo: pedro.id,
      lastMessageAt: new Date('2026-09-26T12:00:00Z'),
    });
    const doisDonos = await createDeal({ leadId: duasLinhas.id, stage: 'em_negociacao', ownerUserId: null });

    // Não mexe: card fechado sem dono, card que já tem dono, conversa sem dono.
    const fechadoLead = await createLead({ phone: '5554991921872' });
    await createConversation({ phone: '5554991921872', leadId: fechadoLead.id, assignedTo: julia.id });
    const fechado = await createDeal({
      leadId: fechadoLead.id, stage: 'perdido', lossReason: 'sem_retorno', ownerUserId: null, closedAt: new Date(),
    });
    const comDonoLead = await createLead({ phone: '5554991921873' });
    await createConversation({ phone: '5554991921873', leadId: comDonoLead.id, assignedTo: julia.id });
    const comDono = await createDeal({ leadId: comDonoLead.id, stage: 'em_negociacao', ownerUserId: carla.id });
    const convSemDonoLead = await createLead({ phone: '5554991921874' });
    await createConversation({ phone: '5554991921874', leadId: convSemDonoLead.id, assignedTo: null });
    const convSemDono = await createDeal({ leadId: convSemDonoLead.id, stage: 'lead_no_comercial', ownerUserId: null });
    const saiu = await createUser({ email: 'saiu@x.com', name: 'Ex-vendedor', isActive: false });
    const doDesativadoLead = await createLead({ phone: '5554991921875' });
    await createConversation({ phone: '5554991921875', leadId: doDesativadoLead.id, assignedTo: saiu.id });
    const doDesativado = await createDeal({ leadId: doDesativadoLead.id, stage: 'lead_no_comercial', ownerUserId: null });

    await pool.query(await readFile(MIGRATION, 'utf-8'));

    expect(await dealOwner(semDono.id)).toBe(julia.id);
    expect(await dealOwner(doisDonos.id)).toBe(pedro.id);
    expect(await dealOwner(fechado.id)).toBeNull();
    expect(await dealOwner(comDono.id)).toBe(carla.id);
    expect(await dealOwner(convSemDono.id)).toBeNull();
    expect(await dealOwner(doDesativado.id)).toBeNull();

    // Correção de dado, não atividade: não escreve no histórico nem mexe em
    // updated_at — senão o selo "parado" (sem atividade há 3 dias) some dos cards
    // corrigidos sem ninguém ter tocado neles.
    const acts = await db.select().from(dealActivities).where(eq(dealActivities.kind, 'owner_changed'));
    expect(acts).toHaveLength(0);
    const [samuelDepois] = await db.select().from(deals).where(eq(deals.id, semDono.id));
    expect(samuelDepois.updatedAt.toISOString()).toBe('2026-09-25T12:44:00.000Z');
  });
});
