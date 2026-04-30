import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { createUser } from './helpers';

const app = createApp();

describe('POST /api/auth/login', () => {
  it('returns access token and sets refresh cookie on valid credentials', async () => {
    await createUser({ email: 'a@b.com', password: 'pw12345' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'a@b.com', password: 'pw12345' });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.user.email).toBe('a@b.com');
    expect(res.headers['set-cookie']?.[0]).toMatch(/lubritec_refresh=/);
  });

  it('returns 401 on invalid credentials', async () => {
    await createUser({ email: 'a@b.com', password: 'pw12345' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'a@b.com', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('returns 400 on validation error', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'not-an-email', password: '' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/refresh', () => {
  it('returns new access token using cookie', async () => {
    await createUser({ email: 'a@b.com', password: 'pw' });
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'a@b.com', password: 'pw' });
    const res = await agent.post('/api/auth/refresh');
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
  });

  it('returns 401 without cookie', async () => {
    const res = await request(app).post('/api/auth/refresh');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/me', () => {
  it('returns current user with valid bearer', async () => {
    await createUser({ email: 'a@b.com', password: 'pw' });
    const login = await request(app).post('/api/auth/login').send({ email: 'a@b.com', password: 'pw' });
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('a@b.com');
  });

  it('returns 401 without bearer', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/users (invite)', () => {
  it('admin can invite a new user', async () => {
    await createUser({ email: 'admin@b.com', password: 'pw', role: 'admin' });
    const login = await request(app).post('/api/auth/login').send({ email: 'admin@b.com', password: 'pw' });
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ email: 'novo@b.com', name: 'Novo', role: 'comercial' });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe('novo@b.com');
  });

  it('non-admin gets 403', async () => {
    await createUser({ email: 'com@b.com', password: 'pw', role: 'comercial' });
    const login = await request(app).post('/api/auth/login').send({ email: 'com@b.com', password: 'pw' });
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ email: 'x@b.com', name: 'X', role: 'comercial' });
    expect(res.status).toBe(403);
  });
});

describe('unknown /api routes', () => {
  it('returns 404 instead of falling through to SPA', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Not found');
  });
});
