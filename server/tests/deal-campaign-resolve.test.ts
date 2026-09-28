import { describe, it, expect } from 'vitest';
import { resolveQualificationCampaign, lastDispatchedCampaign } from '../services/dealCampaign';
import { createUser, createLead, createCampaign, createCampaignRecipient } from './helpers';

const DAY = 86_400_000;
let seq = 0;

async function scenario() {
  seq += 1;
  const u = await createUser({ email: `r${seq}@x.com` });
  const lead = await createLead({ phone: `55549700${String(seq).padStart(5, '0')}` });
  return { u, lead };
}

describe('resolveQualificationCampaign', () => {
  it('devolve a campanha do último disparo quando ela está vigente', async () => {
    const { u, lead } = await scenario();
    const antiga = await createCampaign({ name: 'Antiga', createdByUserId: u.id });
    const nova = await createCampaign({
      name: 'Nova', createdByUserId: u.id,
      validityStart: new Date(Date.now() - DAY), validityEnd: new Date(Date.now() + 6 * DAY),
    });
    await createCampaignRecipient({ campaignId: antiga.id, leadId: lead.id, status: 'sent', sentAt: new Date(Date.now() - 60 * DAY) });
    await createCampaignRecipient({ campaignId: nova.id, leadId: lead.id, status: 'sent', sentAt: new Date(Date.now() - DAY) });

    expect(await resolveQualificationCampaign(lead.id)).toBe(nova.id);
  });

  it('último disparo com vigência vencida → sem campanha', async () => {
    const { u, lead } = await scenario();
    const vencida = await createCampaign({
      name: 'Vencida', createdByUserId: u.id,
      validityStart: new Date(Date.now() - 10 * DAY), validityEnd: new Date(Date.now() - DAY),
    });
    await createCampaignRecipient({ campaignId: vencida.id, leadId: lead.id, status: 'sent', sentAt: new Date(Date.now() - 9 * DAY) });

    expect(await resolveQualificationCampaign(lead.id)).toBeNull();
  });

  it('campanha comum sem vigência (anterior a 31/08) não conta', async () => {
    const { u, lead } = await scenario();
    const antiga = await createCampaign({ name: 'Sem vigência', createdByUserId: u.id });
    await createCampaignRecipient({ campaignId: antiga.id, leadId: lead.id, status: 'sent', sentAt: new Date(Date.now() - DAY) });

    expect(await resolveQualificationCampaign(lead.id)).toBeNull();
  });

  it('campanha contínua é sempre vigente', async () => {
    const { u, lead } = await scenario();
    const continua = await createCampaign({ name: 'Contínua', createdByUserId: u.id, isContinuous: true });
    await createCampaignRecipient({ campaignId: continua.id, leadId: lead.id, status: 'sent', sentAt: new Date(Date.now() - 40 * DAY) });

    expect(await resolveQualificationCampaign(lead.id)).toBe(continua.id);
  });

  it('o instante exato do fim da vigência ainda vale', async () => {
    const { u, lead } = await scenario();
    const fim = new Date(Date.now() + DAY);
    const c = await createCampaign({
      name: 'Até o fim', createdByUserId: u.id, validityStart: new Date(Date.now() - DAY), validityEnd: fim,
    });
    await createCampaignRecipient({ campaignId: c.id, leadId: lead.id, status: 'sent', sentAt: new Date(Date.now() - DAY) });

    expect(await resolveQualificationCampaign(lead.id, fim)).toBe(c.id);
  });

  it('ignora disparo ainda não enviado e lead sem disparo', async () => {
    const { u, lead } = await scenario();
    const c = await createCampaign({
      name: 'Pendente', createdByUserId: u.id,
      validityStart: new Date(), validityEnd: new Date(Date.now() + 6 * DAY),
    });
    await createCampaignRecipient({ campaignId: c.id, leadId: lead.id, status: 'pending' });

    expect(await resolveQualificationCampaign(lead.id)).toBeNull();
  });
});

describe('lastDispatchedCampaign', () => {
  it('último disparo, mesmo com a vigência vencida', async () => {
    const { u, lead } = await scenario();
    const vencida = await createCampaign({
      name: 'Vencida', createdByUserId: u.id,
      validityStart: new Date(Date.now() - 10 * DAY), validityEnd: new Date(Date.now() - DAY),
    });
    await createCampaignRecipient({ campaignId: vencida.id, leadId: lead.id, status: 'sent', sentAt: new Date(Date.now() - 9 * DAY) });

    expect(await lastDispatchedCampaign(lead.id, null)).toBe(vencida.id);
  });

  it('sem disparo, devolve a campanha de origem da conversa', async () => {
    const { u, lead } = await scenario();
    const origem = await createCampaign({ name: 'Origem', createdByUserId: u.id });

    expect(await lastDispatchedCampaign(lead.id, origem.id)).toBe(origem.id);
    expect(await lastDispatchedCampaign(lead.id, null)).toBeNull();
  });
});
