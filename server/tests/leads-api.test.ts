import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import path from 'path';
import { fileURLToPath } from 'url';
import { createApp } from '../app';
import { createUser, createLead } from './helpers';
import * as cnpjLookup from '../services/cnpjLookup';

const app = createApp();

// Keep BrasilAPI calls offline for the suite — every CNPJ comes back active.
beforeEach(() => {
  vi.spyOn(cnpjLookup, 'lookupCnpj').mockImplementation(async (cnpj: string) => ({
    cnpj,
    status: 'active',
    razaoSocial: 'Test Co.',
    situacaoCadastral: 'ATIVA',
    telefone: null,
  }));
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loginAs(email: string, password = 'pw12345') {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return res.body.accessToken as string;
}

async function seedAuth() {
  await createUser({ email: 'r@x.com', password: 'pw12345', role: 'recepcao' });
  return loginAs('r@x.com');
}

describe('GET /api/leads', () => {
  it('401 sem token', async () => {
    const res = await request(app).get('/api/leads');
    expect(res.status).toBe(401);
  });

  it('200 com lista paginada', async () => {
    const token = await seedAuth();
    await createLead({ name: 'A', phone: '11000001001' });
    const res = await request(app).get('/api/leads').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toBeInstanceOf(Array);
    expect(res.body.total).toBeGreaterThan(0);
    expect(res.body.pageSize).toBe(50);
  });

  it('400 quando page exorbitante', async () => {
    const token = await seedAuth();
    const res = await request(app)
      .get('/api/leads?page=999999999')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/leads', () => {
  it('401 sem token', async () => {
    const res = await request(app).post('/api/leads').send({ name: 'X', phone: '11000002001' });
    expect(res.status).toBe(401);
  });

  it('cria lead 200 com defaults', async () => {
    const token = await seedAuth();
    const res = await request(app)
      .post('/api/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Pedro', phone: '11000002002', cnpj: '11444777000161' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('frio');
    expect(res.body.source).toBe('manual');
  });

  it('400 quando phone tem menos de 8 dígitos após normalização', async () => {
    const token = await seedAuth();
    const res = await request(app)
      .post('/api/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Curto', phone: '(11) 12', cnpj: '11444777000161' });
    expect(res.status).toBe(400);
  });

  it('409 quando CNPJ duplicado', async () => {
    const token = await seedAuth();
    await createLead({ phone: '11000002003', cnpj: '60746948000112' });
    const res = await request(app)
      .post('/api/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Dup', phone: '11000002099', cnpj: '60746948000112' });
    expect(res.status).toBe(409);
  });
});

describe('PATCH /api/leads/:id', () => {
  it('401 sem token', async () => {
    const lead = await createLead({ phone: '11000003001' });
    const res = await request(app).patch(`/api/leads/${lead.id}`).send({ name: 'X' });
    expect(res.status).toBe(401);
  });

  it('200 atualiza campos permitidos', async () => {
    const token = await seedAuth();
    const lead = await createLead({ phone: '11000003002', name: 'Old' });
    const res = await request(app)
      .patch(`/api/leads/${lead.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'New', status: 'quente' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('New');
    expect(res.body.status).toBe('quente');
  });

  it('400 quando phone está no body', async () => {
    const token = await seedAuth();
    const lead = await createLead({ phone: '11000003003' });
    const res = await request(app)
      .patch(`/api/leads/${lead.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: '11000003999' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Phone cannot be edited');
  });

  it('404 quando id não existe', async () => {
    const token = await seedAuth();
    const res = await request(app)
      .patch('/api/leads/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'X' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/leads/:id', () => {
  it('401 sem token', async () => {
    const lead = await createLead({ phone: '11000004001' });
    const res = await request(app).delete(`/api/leads/${lead.id}`);
    expect(res.status).toBe(401);
  });

  it('204 ao deletar', async () => {
    const token = await seedAuth();
    const lead = await createLead({ phone: '11000004002' });
    const res = await request(app)
      .delete(`/api/leads/${lead.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);
  });

  it('404 quando id não existe', async () => {
    const token = await seedAuth();
    const res = await request(app)
      .delete('/api/leads/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/leads/import', () => {
  it('401 sem token', async () => {
    const res = await request(app)
      .post('/api/leads/import')
      .attach('file', path.resolve(__dirname, 'fixtures/leads-sample.csv'));
    expect(res.status).toBe(401);
  });

  it('importa fixture, retorna relatório', async () => {
    const token = await seedAuth();
    const res = await request(app)
      .post('/api/leads/import')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', path.resolve(__dirname, 'fixtures/leads-sample.csv'));
    expect(res.status).toBe(200);
    expect(res.body.inserted).toBe(2);
    expect(res.body.rejected).toHaveLength(1);
    expect(res.body.rejected[0].line).toBe(4);
  });

  it('400 quando header obrigatório falta', async () => {
    const token = await seedAuth();
    const res = await request(app)
      .post('/api/leads/import')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('nome\nA\n'), 'bad.csv');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Coluna obrigatória ausente/);
  });

  it('400 quando mime inválido', async () => {
    const token = await seedAuth();
    const res = await request(app)
      .post('/api/leads/import')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('whatever'), { filename: 'bad.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid file type/);
  });
});
