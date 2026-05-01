import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { createUser, createMessageTemplate } from './helpers';

const app = createApp();

async function loginAs(email = 'r@x.com', password = 'pw12345') {
  const u = await createUser({ email, password, role: 'recepcao' });
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return { token: res.body.accessToken as string, userId: u.id };
}

describe('GET /api/message-templates', () => {
  it('401 sem token', async () => {
    const res = await request(app).get('/api/message-templates');
    expect(res.status).toBe(401);
  });

  it('200 lista templates', async () => {
    const { token, userId } = await loginAs();
    await createMessageTemplate({ title: 'Boas-vindas', body: 'Oi!', createdBy: userId });

    const res = await request(app).get('/api/message-templates').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toBeInstanceOf(Array);
    expect(res.body.items[0].title).toBe('Boas-vindas');
  });
});

describe('POST /api/message-templates', () => {
  it('200 cria template', async () => {
    const { token } = await loginAs();
    const res = await request(app)
      .post('/api/message-templates')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Horário', body: 'Estamos abertos das 8h às 18h.' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Horário');
    expect(res.body.createdBy.id).toBeDefined();
  });

  it('400 quando título ou body vazio', async () => {
    const { token } = await loginAs();
    const res = await request(app)
      .post('/api/message-templates')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: '', body: '' });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/message-templates/:id', () => {
  it('200 edita template', async () => {
    const { token, userId } = await loginAs();
    const t = await createMessageTemplate({ title: 'A', body: 'B', createdBy: userId });

    const res = await request(app)
      .patch(`/api/message-templates/${t.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'A2' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('A2');
  });

  it('404 quando id não existe', async () => {
    const { token } = await loginAs();
    const res = await request(app)
      .patch('/api/message-templates/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'X' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/message-templates/:id', () => {
  it('204 deleta', async () => {
    const { token, userId } = await loginAs();
    const t = await createMessageTemplate({ title: 'A', body: 'B', createdBy: userId });
    const res = await request(app)
      .delete(`/api/message-templates/${t.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);
  });
});
