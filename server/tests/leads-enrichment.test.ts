import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../app';
import { db } from '../db/client';
import { leads } from '../db/schema';
import { createUser, createLead } from './helpers';

vi.mock('../services/cnpjLookup', () => ({
  lookupCnpj: vi.fn(),
}));

import { lookupCnpj } from '../services/cnpjLookup';

const app = createApp();

async function loginAs(email = 'r@x.com', password = 'pw12345') {
  await createUser({ email, password, role: 'recepcao' });
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return res.body.accessToken as string;
}

beforeEach(() => {
  vi.mocked(lookupCnpj).mockReset();
});

describe('POST /api/leads/:id/enrich', () => {
  it('401 sem token', async () => {
    const res = await request(app).post('/api/leads/00000000-0000-0000-0000-000000000000/enrich');
    expect(res.status).toBe(401);
  });

  it('404 quando lead não existe', async () => {
    const token = await loginAs();
    const res = await request(app)
      .post('/api/leads/00000000-0000-0000-0000-000000000000/enrich')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('400 quando lead já tem telefone', async () => {
    const token = await loginAs();
    const lead = await createLead({ phone: '5511900000001', cnpj: '11444777000161' });
    const res = await request(app)
      .post(`/api/leads/${lead.id}/enrich`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/já tem telefone/i);
  });

  it('400 quando lead não tem CNPJ', async () => {
    const token = await loginAs();
    const lead = await createLead({ phone: null, cnpj: undefined });
    // createLead helper sempre seta um cnpj; força null pra esse teste
    await db.update(leads).set({ cnpj: null }).where(eq(leads.id, lead.id));

    const res = await request(app)
      .post(`/api/leads/${lead.id}/enrich`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sem CNPJ/i);
  });

  it('200 phone_found: BrasilAPI retornou telefone → atualiza lead + flow_stage=complete', async () => {
    vi.mocked(lookupCnpj).mockResolvedValueOnce({
      cnpj: '11444777000161',
      status: 'active',
      razaoSocial: 'Empresa X',
      situacaoCadastral: 'ATIVA',
      telefone: '5499456069', // formato com DDD sem DDI
    });
    const token = await loginAs();
    const lead = await createLead({ phone: null, cnpj: '11444777000161' });

    const res = await request(app)
      .post(`/api/leads/${lead.id}/enrich`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('phone_found');
    expect(res.body.phoneFound).toBe('555499456069'); // 55 + DDD + número

    const [updated] = await db.select().from(leads).where(eq(leads.id, lead.id));
    expect(updated.phone).toBe('555499456069');
    expect(updated.flowStage).toBe('complete');
  });

  it('200 phone_not_in_brasilapi: ativa mas sem telefone', async () => {
    vi.mocked(lookupCnpj).mockResolvedValueOnce({
      cnpj: '11444777000162',
      status: 'active',
      razaoSocial: 'Empresa Y',
      situacaoCadastral: 'ATIVA',
      telefone: null,
    });
    const token = await loginAs();
    const lead = await createLead({ phone: null, cnpj: '11444777000162' });

    const res = await request(app)
      .post(`/api/leads/${lead.id}/enrich`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('phone_not_in_brasilapi');

    const [updated] = await db.select().from(leads).where(eq(leads.id, lead.id));
    expect(updated.phone).toBeNull();
    expect(updated.flowStage).toBe('incomplete');
  });

  it('200 cnpj_not_found', async () => {
    vi.mocked(lookupCnpj).mockResolvedValueOnce({
      cnpj: '11444777000163',
      status: 'not_found',
      razaoSocial: null,
      situacaoCadastral: null,
      telefone: null,
    });
    const token = await loginAs();
    const lead = await createLead({ phone: null, cnpj: '11444777000163' });

    const res = await request(app)
      .post(`/api/leads/${lead.id}/enrich`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cnpj_not_found');
  });

  it('200 cnpj_inactive devolve mensagem da situação', async () => {
    vi.mocked(lookupCnpj).mockResolvedValueOnce({
      cnpj: '11444777000164',
      status: 'inactive',
      razaoSocial: 'Inativa Ltda',
      situacaoCadastral: 'BAIXADA',
      telefone: null,
    });
    const token = await loginAs();
    const lead = await createLead({ phone: null, cnpj: '11444777000164' });

    const res = await request(app)
      .post(`/api/leads/${lead.id}/enrich`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cnpj_inactive');
    expect(res.body.errorMessage).toMatch(/BAIXADA/);
  });

  it('200 api_error quando BrasilAPI falha', async () => {
    vi.mocked(lookupCnpj).mockResolvedValueOnce({
      cnpj: '11444777000165',
      status: 'error',
      razaoSocial: null,
      situacaoCadastral: null,
      telefone: null,
      errorMessage: 'BrasilAPI 500',
    });
    const token = await loginAs();
    const lead = await createLead({ phone: null, cnpj: '11444777000165' });

    const res = await request(app)
      .post(`/api/leads/${lead.id}/enrich`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('api_error');
    expect(res.body.errorMessage).toMatch(/BrasilAPI 500/);
  });

  it('telefone com 10 dígitos (fixo) também recebe DDI 55', async () => {
    vi.mocked(lookupCnpj).mockResolvedValueOnce({
      cnpj: '11444777000166',
      status: 'active',
      razaoSocial: 'X',
      situacaoCadastral: 'ATIVA',
      telefone: '5432214455', // 10 dígitos
    });
    const token = await loginAs();
    const lead = await createLead({ phone: null, cnpj: '11444777000166' });

    const res = await request(app)
      .post(`/api/leads/${lead.id}/enrich`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.phoneFound).toBe('555432214455');
  });

  it('telefone com 13 dígitos (já tem DDI) preserva', async () => {
    vi.mocked(lookupCnpj).mockResolvedValueOnce({
      cnpj: '11444777000167',
      status: 'active',
      razaoSocial: 'X',
      situacaoCadastral: 'ATIVA',
      telefone: '5511987654321', // 13 dígitos
    });
    const token = await loginAs();
    const lead = await createLead({ phone: null, cnpj: '11444777000167' });

    const res = await request(app)
      .post(`/api/leads/${lead.id}/enrich`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.phoneFound).toBe('5511987654321');
  });
});
