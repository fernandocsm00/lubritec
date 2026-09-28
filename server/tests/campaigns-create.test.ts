import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
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

  // Caso da campanha "orion" (28/09/2026): 6957 elegíveis, 6956 desmarcados pra
  // disparar pra um contato só. A lista de exclusões (~270 KB de UUIDs) passava
  // do limite de 100 KB do express.json e a prévia falhava — a tela ficava com o
  // total antigo, sem exclusão nenhuma.
  it('prévia aceita milhares de exclusões (disparar pra poucos entre muitos)', async () => {
    const fica = await createLead({ name: 'Fernando Teixeira', phone: '5554999456069', status: 'frio' });
    const sai = await createLead({ phone: '5511000080021', status: 'frio' });
    const excluded = [sai.id, ...Array.from({ length: 7000 }, () => randomUUID())];
    const token = await loginAdmin();

    const res = await request(app)
      .post('/api/campaigns/dry-run')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: ['frio'], excludeLeadIds: excluded });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.eligible).toBe(1);
    expect(res.body.preview.map((p: { leadId: string }) => p.leadId)).toEqual([fica.id]);
  });

  it('aceita busca (q) na query string e filtra só a lista', async () => {
    await createLead({ name: 'Débora Leal', phone: '5511000080011', status: 'frio' });
    await createLead({ name: 'Fabio Mota', phone: '5511000080012', status: 'frio' });
    const token = await loginAdmin();
    const res = await request(app)
      .post('/api/campaigns/dry-run?q=debora')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: ['frio'] });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.matchCount).toBe(1);
    expect(res.body.preview.map((p: { name: string }) => p.name)).toEqual(['Débora Leal']);
  });
});

describe('POST /api/campaigns', () => {
  it('criar com milhares de exclusões materializa só quem ficou', async () => {
    const fica = await createLead({ name: 'Fernando Teixeira', phone: '5554999456069', status: 'frio' });
    const sai = await createLead({ phone: '5511000090021', status: 'frio' });
    const excluded = [sai.id, ...Array.from({ length: 7000 }, () => randomUUID())];
    const token = await loginAdmin();

    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'orion',
        instanceId: defaultInstanceId,
        messageBody: 'Olá {{nome}}!',
        audienceFilter: { status: ['frio'], excludeLeadIds: excluded },
      });

    expect(res.status).toBe(201);
    const recipients = await db.select().from(campaignRecipients).where(eq(campaignRecipients.campaignId, res.body.id));
    expect(recipients.map((r) => r.leadId)).toEqual([fica.id]);
  });

  it('seleção acima do limite responde 413 com mensagem clara (não 500)', async () => {
    const token = await loginAdmin();
    const huge = Array.from({ length: 60_000 }, () => randomUUID()); // ~2,3 MB

    const res = await request(app)
      .post('/api/campaigns/dry-run')
      .set('Authorization', `Bearer ${token}`)
      .send({ excludeLeadIds: huge });

    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/grande demais/i);
  });

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
