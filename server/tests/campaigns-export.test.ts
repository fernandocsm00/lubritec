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
