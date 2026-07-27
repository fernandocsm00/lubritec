import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { createUser, createLead, createCampaign, createCampaignRecipient } from './helpers';
import { dryRun, resolveAudience } from '../services/campaignsAudience';

const app = createApp();

const VALID_CNPJ_1 = '11444777000161';
const VALID_CNPJ_2 = '00360305000104';
const VALID_CNPJ_3 = '33000167000101';

async function loginAdmin(email: string) {
  const u = await createUser({ email, password: 'pw12345', role: 'admin' });
  const res = await request(app).post('/api/auth/login').send({ email, password: 'pw12345' });
  return { token: res.body.accessToken as string, userId: u.id };
}

describe('POST /api/campaigns/audience/import', () => {
  it('importa por CNPJ e devolve importedLeadIds', async () => {
    const { token } = await loginAdmin('imp1@x.com');
    const csv = `nome,cnpj,telefone\nEmpresa A,${VALID_CNPJ_1},11999990000\nEmpresa B,${VALID_CNPJ_2},11999990001\n`;
    const res = await request(app)
      .post('/api/campaigns/audience/import')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from(csv), 'audiencia.csv');

    expect(res.status).toBe(200);
    expect(res.body.report.inserted).toBe(2);
    expect(res.body.importedLeadIds).toHaveLength(2);
    expect(res.body.previouslyParticipated).toEqual([]);
  });

  it('rejeita linha sem CNPJ', async () => {
    const { token } = await loginAdmin('imp2@x.com');
    const csv = `nome,cnpj,telefone\nSem CNPJ,,11999990010\nCom CNPJ,${VALID_CNPJ_1},11999990011\n`;
    const res = await request(app)
      .post('/api/campaigns/audience/import')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from(csv), 'audiencia.csv');

    expect(res.status).toBe(200);
    expect(res.body.report.inserted).toBe(1);
    expect(res.body.report.rejected.some((r: { reason: string }) => /cnpj/i.test(r.reason))).toBe(true);
  });

  it('marca CNPJ que já participou de campanha anterior', async () => {
    const { token, userId } = await loginAdmin('imp3@x.com');
    // Lead + campanha + recipient anteriores
    const lead = await createLead({ phone: '11999990020', cnpj: VALID_CNPJ_3 });
    const campaign = await createCampaign({ name: 'Reativação Junho', createdByUserId: userId });
    await createCampaignRecipient({ campaignId: campaign.id, leadId: lead.id, phone: '11999990020', status: 'sent', sentAt: new Date() });

    const csv = `nome,cnpj,telefone\nEmpresa C,${VALID_CNPJ_3},11999990020\n`;
    const res = await request(app)
      .post('/api/campaigns/audience/import')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from(csv), 'audiencia.csv');

    expect(res.status).toBe(200);
    expect(res.body.previouslyParticipated).toHaveLength(1);
    expect(res.body.previouslyParticipated[0].cnpj).toBe(VALID_CNPJ_3);
    expect(res.body.previouslyParticipated[0].lastCampaign.name).toBe('Reativação Junho');
  });
});

describe('audiência por importedLeadIds', () => {
  it('dryRun/resolveAudience usam os leads importados e respeitam excludeLeadIds', async () => {
    const a = await createLead({ phone: '11999990030', cnpj: VALID_CNPJ_1 });
    const b = await createLead({ phone: '11999990031', cnpj: VALID_CNPJ_2 });

    const dr = await dryRun({ importedLeadIds: [a.id, b.id] });
    expect(dr.total).toBe(2);

    const drExcl = await dryRun({ importedLeadIds: [a.id, b.id], excludeLeadIds: [b.id] });
    expect(drExcl.total).toBe(1);

    const audience = await resolveAudience({ importedLeadIds: [a.id, b.id], excludeLeadIds: [b.id] });
    expect(audience.map((x) => x.leadId)).toEqual([a.id]);
  });
});
