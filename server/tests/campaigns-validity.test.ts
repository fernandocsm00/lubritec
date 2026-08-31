import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { createUser, createLead, createWhatsappInstance, createCampaign } from './helpers';

const app = createApp();
const DAY = 24 * 60 * 60 * 1000;

let instanceId: string;

beforeEach(async () => {
  const inst = await createWhatsappInstance({ isDefault: true, displayName: 'Default' });
  instanceId = inst.id;
  await createLead({ phone: '5511000110001', status: 'frio' });
});

async function loginAdmin(email: string) {
  await createUser({ email, password: 'pw12345', role: 'admin' });
  const res = await request(app).post('/api/auth/login').send({ email, password: 'pw12345' });
  return res.body.accessToken as string;
}

function create(token: string, body: Record<string, unknown>) {
  return request(app)
    .post('/api/campaigns')
    .set('Authorization', `Bearer ${token}`)
    .send({
      name: 'Promo',
      instanceId,
      messageBody: 'Olá!',
      audienceFilter: { status: ['frio'] },
      ...body,
    });
}

/** Diferença em dias entre duas datas ISO, arredondada. */
function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / DAY);
}

describe('vigência da campanha', () => {
  it('sem informar nada: início = agora e fim = início + 7 dias', async () => {
    const token = await loginAdmin('v1@x.com');
    const before = Date.now();

    const res = await create(token, {});

    expect(res.status).toBe(201);
    expect(res.body.validityStart).toBeTruthy();
    expect(res.body.validityEnd).toBeTruthy();
    const start = new Date(res.body.validityStart).getTime();
    expect(start).toBeGreaterThanOrEqual(before - 5_000);
    expect(daysBetween(res.body.validityStart, res.body.validityEnd)).toBe(7);
  });

  it('agendada: o início acompanha o agendamento, não a criação', async () => {
    // O default precisa espelhar quando a oferta começa a valer pro cliente,
    // que é o disparo — não o momento em que alguém montou a campanha.
    const token = await loginAdmin('v2@x.com');
    const scheduledAt = new Date(Date.now() + 3 * DAY).toISOString();

    const res = await create(token, { scheduledAt });

    expect(res.status).toBe(201);
    expect(daysBetween(scheduledAt, res.body.validityStart)).toBe(0);
    expect(daysBetween(res.body.validityStart, res.body.validityEnd)).toBe(7);
  });

  it('informando só o fim, o início segue o default', async () => {
    const token = await loginAdmin('v3@x.com');
    const validityEnd = new Date(Date.now() + 30 * DAY).toISOString();

    const res = await create(token, { validityEnd });

    expect(res.status).toBe(201);
    expect(res.body.validityStart).toBeTruthy();
    expect(daysBetween(res.body.validityStart, res.body.validityEnd)).toBe(30);
  });

  it('informando só o início, o fim vira início + 7', async () => {
    const token = await loginAdmin('v4@x.com');
    const validityStart = new Date(Date.now() + 10 * DAY).toISOString();

    const res = await create(token, { validityStart });

    expect(res.status).toBe(201);
    expect(daysBetween(validityStart, res.body.validityStart)).toBe(0);
    expect(daysBetween(res.body.validityStart, res.body.validityEnd)).toBe(7);
  });

  it('informando os dois, respeita exatamente', async () => {
    const token = await loginAdmin('v5@x.com');
    const validityStart = new Date(Date.now() + DAY).toISOString();
    const validityEnd = new Date(Date.now() + 45 * DAY).toISOString();

    const res = await create(token, { validityStart, validityEnd });

    expect(res.status).toBe(201);
    expect(daysBetween(res.body.validityStart, res.body.validityEnd)).toBe(44);
  });

  it('422 quando o fim é anterior ao início', async () => {
    // Erro de digitação mais provável. Sem a checagem, a campanha nasceria
    // expirada no mesmo instante em que foi criada.
    const token = await loginAdmin('v6@x.com');
    const validityStart = new Date(Date.now() + 10 * DAY).toISOString();
    const validityEnd = new Date(Date.now() + DAY).toISOString();

    const res = await create(token, { validityStart, validityEnd });

    expect(res.status).toBe(422);
  });
});

describe('filtro por vigência na listagem', () => {
  async function seed(token: string) {
    const DAYm = 24 * 60 * 60 * 1000;
    await create(token, {
      name: 'VigenteX',
      validityStart: new Date(Date.now() - DAYm).toISOString(),
      validityEnd: new Date(Date.now() + 5 * DAYm).toISOString(),
    });
    await create(token, {
      name: 'ExpiradaX',
      validityStart: new Date(Date.now() - 20 * DAYm).toISOString(),
      validityEnd: new Date(Date.now() - 2 * DAYm).toISOString(),
    });
  }

  function list(token: string, qs: string) {
    return request(app).get(`/api/campaigns${qs}`).set('Authorization', `Bearer ${token}`);
  }

  it('validity=vigente traz só as que ainda valem', async () => {
    const token = await loginAdmin('v7@x.com');
    await seed(token);

    const res = await list(token, '?validity=vigente');

    expect(res.status).toBe(200);
    const nomes = res.body.items.map((c: { name: string }) => c.name);
    expect(nomes).toContain('VigenteX');
    expect(nomes).not.toContain('ExpiradaX');
  });

  it('validity=expirada traz só as que já passaram', async () => {
    const token = await loginAdmin('v8@x.com');
    await seed(token);

    const res = await list(token, '?validity=expirada');

    const nomes = res.body.items.map((c: { name: string }) => c.name);
    expect(nomes).toContain('ExpiradaX');
    expect(nomes).not.toContain('VigenteX');
  });

it('validity=sem_vigencia traz as campanhas anteriores ao recurso', async () => {
    // Campanhas criadas antes da migration 045 têm validity_end nulo. Elas não
    // são "expiradas" — ninguém informou vigência — e precisam de grupo próprio.
    const token = await loginAdmin('v10@x.com');
    await seed(token);
    const u = await createUser({ email: 'v10b@x.com', role: 'admin' });
    await createCampaign({ name: 'AntigaX', createdByUserId: u.id });

    const res = await list(token, '?validity=sem_vigencia');

    expect(res.status).toBe(200);
    const nomes = res.body.items.map((c: { name: string }) => c.name);
    expect(nomes).toContain('AntigaX');
    expect(nomes).not.toContain('VigenteX');
    expect(nomes).not.toContain('ExpiradaX');
  });

  it('sem o parâmetro, traz as duas', async () => {
    const token = await loginAdmin('v9@x.com');
    await seed(token);

    const res = await list(token, '');

    const nomes = res.body.items.map((c: { name: string }) => c.name);
    expect(nomes).toEqual(expect.arrayContaining(['VigenteX', 'ExpiradaX']));
  });
});
