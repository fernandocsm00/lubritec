import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { db } from '../db/client';
import { campaignRecipients } from '../db/schema';
import { eq } from 'drizzle-orm';
import { leads } from '../db/schema';
import { createUser, createLead, createWhatsappInstance } from './helpers';

const app = createApp();

let defaultInstanceId: string;

beforeEach(async () => {
  const inst = await createWhatsappInstance({ isDefault: true, displayName: 'Default' });
  defaultInstanceId = inst.id;
});

async function loginAdmin() {
  await createUser({ email: 'a@x.com', password: 'pw12345', role: 'admin' });
  const res = await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: 'pw12345' });
  return res.body.accessToken as string;
}

describe('POST /api/campaigns/dry-run', () => {
  it('200 retorna total + preview', async () => {
    await createLead({ phone: '5511000080001', status: 'frio' });
    await createLead({ phone: '5511000080002', status: 'frio' });
    const token = await loginAdmin();
    const res = await request(app)
      .post('/api/campaigns/dry-run')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: ['frio'] });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
  });
});

describe('POST /api/campaigns', () => {
  it('201 cria campanha + materializa recipients', async () => {
    await createLead({ phone: '5511000090001', status: 'frio' });
    await createLead({ phone: '5511000090002', status: 'frio' });
    const token = await loginAdmin();
    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Lembrete frio',
        instanceId: defaultInstanceId,
        messageBody: 'Olá {{nome}}, hora de trocar!',
        audienceFilter: { status: ['frio'] },
      });
    expect(res.status).toBe(201);
    expect(res.body.audienceTotal).toBe(2);

    const recipients = await db.select().from(campaignRecipients).where(eq(campaignRecipients.campaignId, res.body.id));
    expect(recipients).toHaveLength(2);
  });

  it('CSV com telefones novos cria leads e os inclui como recipients', async () => {
    // 1 telefone já é lead; 2 são novos (só existem no CSV).
    await createLead({ phone: '5511987660001', status: 'quente', source: 'whatsapp' });
    const token = await loginAdmin();
    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Blast lista nova',
        instanceId: defaultInstanceId,
        messageBody: 'Olá! Promoção de troca de óleo.',
        // Filtro de status seria frio, mas CSV ignora filtros e dispara pra lista toda.
        audienceFilter: {
          status: ['frio'],
          phoneCsv: ['5511987660001', '5511987660002', '5511987660003'],
        },
      });
    expect(res.status).toBe(201);
    expect(res.body.audienceTotal).toBe(3); // existente + 2 novos

    // Os 2 telefones novos viraram leads (source=csv).
    const created = await db.select().from(leads).where(eq(leads.source, 'csv'));
    const createdPhones = created.map((l) => l.phone);
    expect(createdPhones).toContain('5511987660002');
    expect(createdPhones).toContain('5511987660003');

    const recipients = await db.select().from(campaignRecipients).where(eq(campaignRecipients.campaignId, res.body.id));
    expect(recipients).toHaveLength(3);
  });

  it('snapshot de messageBody preservado mesmo após template mudar', async () => {
    await createLead({ phone: '5511000091001', status: 'frio' });
    const token = await loginAdmin();
    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'X',
        instanceId: defaultInstanceId,
        messageBody: 'Texto original',
        audienceFilter: { status: ['frio'] },
      });
    expect(res.status).toBe(201);
    expect(res.body.messageBody).toBe('Texto original');
  });
});
