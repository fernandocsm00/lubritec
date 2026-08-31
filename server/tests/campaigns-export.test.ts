import { describe, it, expect } from 'vitest';
import {
  createUser, createLead, createCampaign, createCampaignRecipient,
  createConversation, createMessage, createDeal,
} from './helpers';
import { getCampaignFunnel, getCampaignFunnelsBatch } from '../services/campaignsService';

/**
 * O CSV de resumo não pode divergir do que a tela de detalhe mostra. Como a
 * versão em lote é uma reimplementação (4 queries por campanha viraria 4×N),
 * os testes abaixo são de EQUIVALÊNCIA: montam um cenário e exigem que o lote
 * devolva exatamente o mesmo objeto que getCampaignFunnel devolve sozinho.
 */
describe('getCampaignFunnelsBatch', () => {
  it('devolve, para cada campanha, o mesmo funil que getCampaignFunnel', async () => {
    const u = await createUser({ email: 'exp1@x.com', role: 'admin' });

    // Campanha A: sent/failed/skipped + resposta + deals ganho e perdido
    const a = await createCampaign({ createdByUserId: u.id, name: 'A' });
    const l1 = await createLead({ phone: '5511000900001' });
    const l2 = await createLead({ phone: '5511000900002' });
    const l3 = await createLead({ phone: '5511000900003' });
    const sentAt = new Date(Date.now() - 60_000);
    await createCampaignRecipient({ campaignId: a.id, leadId: l1.id, status: 'sent', sentAt });
    await createCampaignRecipient({ campaignId: a.id, leadId: l2.id, status: 'failed' });
    await createCampaignRecipient({
      campaignId: a.id, leadId: l3.id, status: 'skipped', failureReason: 'cooldown_24h',
    });

    const conv = await createConversation({ phone: l1.phone ?? undefined, leadId: l1.id });
    await createMessage({ conversationId: conv.id, direction: 'in', body: 'oi', sentAt: new Date() });

    await createDeal({ leadId: l1.id, stage: 'ganho', proposalValue: 1500 });
    await createDeal({ leadId: l2.id, stage: 'perdido', lossReason: 'preco' });

    // Campanha B: só pendentes, para cobrir o caso sem envio
    const b = await createCampaign({ createdByUserId: u.id, name: 'B' });
    const l4 = await createLead({ phone: '5511000900004' });
    await createCampaignRecipient({ campaignId: b.id, leadId: l4.id, status: 'pending' });

    const [soloA, soloB] = await Promise.all([
      getCampaignFunnel(a.id),
      getCampaignFunnel(b.id),
    ]);
    const batch = await getCampaignFunnelsBatch([a.id, b.id]);

    expect(batch.get(a.id)).toEqual(soloA);
    expect(batch.get(b.id)).toEqual(soloB);
  });

  it('campanha sem destinatários vem zerada, não ausente', async () => {
    const u = await createUser({ email: 'exp2@x.com', role: 'admin' });
    const c = await createCampaign({ createdByUserId: u.id, name: 'vazia' });

    const batch = await getCampaignFunnelsBatch([c.id]);

    expect(batch.get(c.id)).toEqual(await getCampaignFunnel(c.id));
    expect(batch.get(c.id)?.totalRecipients).toBe(0);
  });

  it('lista vazia não vai ao banco e devolve mapa vazio', async () => {
    const batch = await getCampaignFunnelsBatch([]);
    expect(batch.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Endpoints de exportação
// ---------------------------------------------------------------------------

import request from 'supertest';
import { createApp } from '../app';

const app = createApp();

async function loginAs(email: string, role: 'admin' | 'comercial' | 'recepcao') {
  const u = await createUser({ email, password: 'pw12345', role });
  const res = await request(app).post('/api/auth/login').send({ email, password: 'pw12345' });
  return { token: res.body.accessToken as string, userId: u.id };
}

/** Divide o CSV em linhas, descartando o BOM. */
function csvLines(text: string): string[] {
  return text.replace(/^﻿/, '').split('\r\n');
}

describe('GET /api/campaigns/export.csv', () => {
  it('401 sem token', async () => {
    const res = await request(app).get('/api/campaigns/export.csv');
    expect(res.status).toBe(401);
  });

  it('403 pra recepção', async () => {
    const { token } = await loginAs('exp-r@x.com', 'recepcao');
    const res = await request(app).get('/api/campaigns/export.csv').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('responde CSV com cabeçalho e uma linha por campanha', async () => {
    const { token, userId } = await loginAs('exp-a@x.com', 'admin');
    await createCampaign({ name: 'Alfa', createdByUserId: userId });
    await createCampaign({ name: 'Beta', createdByUserId: userId });

    const res = await request(app).get('/api/campaigns/export.csv').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['content-disposition']).toContain('.csv');

    const lines = csvLines(res.text);
    expect(lines[0]).toBe(
      'nome;status;tipo;criada_em;agendada_para;vigencia_inicio;vigencia_fim;vigencia_situacao;total_destinatarios;enviadas;falhas;pulados;pulados_cooldown;pulados_outros;respondidas;em_negociacao;ganho;perdido;valor_ganho',
    );
    expect(res.text).toContain('Alfa');
    expect(res.text).toContain('Beta');
  });

  it('respeita o filtro de status', async () => {
    const { token, userId } = await loginAs('exp-b@x.com', 'admin');
    await createCampaign({ name: 'RodandoX', status: 'running', createdByUserId: userId });
    await createCampaign({ name: 'RascunhoX', status: 'draft', createdByUserId: userId });

    const res = await request(app)
      .get('/api/campaigns/export.csv?status=running')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('RodandoX');
    expect(res.text).not.toContain('RascunhoX');
  });
});

describe('GET /api/campaigns/:id/recipients.csv', () => {
  it('403 pra recepção', async () => {
    const { token } = await loginAs('exp-c@x.com', 'recepcao');
    const { userId } = await loginAs('exp-c2@x.com', 'admin');
    const c = await createCampaign({ createdByUserId: userId });
    const res = await request(app)
      .get(`/api/campaigns/${c.id}/recipients.csv`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('404 para campanha inexistente', async () => {
    const { token } = await loginAs('exp-d@x.com', 'admin');
    const res = await request(app)
      .get('/api/campaigns/11111111-1111-4111-8111-111111111111/recipients.csv')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('exporta TODOS os destinatários, além do limite de paginação', async () => {
    const { token, userId } = await loginAs('exp-e@x.com', 'admin');
    const c = await createCampaign({ createdByUserId: userId });
    const N = 55; // RECIPIENTS_PAGE_SIZE é 50 — o export não pode parar na página 1
    for (let i = 0; i < N; i++) {
      const lead = await createLead({ phone: `55119991${String(i).padStart(5, '0')}` });
      await createCampaignRecipient({ campaignId: c.id, leadId: lead.id, status: 'sent', sentAt: new Date() });
    }

    const res = await request(app)
      .get(`/api/campaigns/${c.id}/recipients.csv`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const lines = csvLines(res.text);
    expect(lines[0]).toBe('lead;telefone;status;enviada_em;erro');
    expect(lines.length).toBe(N + 1);
  });

  it('respeita o filtro de status', async () => {
    const { token, userId } = await loginAs('exp-f@x.com', 'admin');
    const c = await createCampaign({ createdByUserId: userId });
    const l1 = await createLead({ phone: '5511998800001', name: 'EnviadoZ' });
    const l2 = await createLead({ phone: '5511998800002', name: 'FalhouZ' });
    await createCampaignRecipient({ campaignId: c.id, leadId: l1.id, status: 'sent', sentAt: new Date() });
    await createCampaignRecipient({ campaignId: c.id, leadId: l2.id, status: 'failed' });

    const res = await request(app)
      .get(`/api/campaigns/${c.id}/recipients.csv?status=sent`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('EnviadoZ');
    expect(res.text).not.toContain('FalhouZ');
  });
});
