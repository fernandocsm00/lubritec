import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { createUser } from './helpers';

const app = createApp();

async function loginAdmin() {
  await createUser({ email: 'a@x.com', password: 'pw12345', role: 'admin' });
  const res = await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: 'pw12345' });
  return res.body.accessToken as string;
}

const TINY_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63000100000005000100' +
  '0d0a2db40000000049454e44ae426082',
  'hex',
);

describe('POST /api/campaigns/upload-media', () => {
  it('200 retorna mediaUrl + mediaMime', async () => {
    const token = await loginAdmin();
    const res = await request(app)
      .post('/api/campaigns/upload-media')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', TINY_PNG, { filename: 'tiny.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.body.mediaUrl).toMatch(/^\/uploads\/campaigns\/[a-f0-9]{32}\.png$/);
    expect(res.body.mediaMime).toBe('image/png');
  });

  it('400 com mime inválido', async () => {
    const token = await loginAdmin();
    const res = await request(app)
      .post('/api/campaigns/upload-media')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('whatever'), { filename: 'x.txt', contentType: 'text/plain' });
    expect(res.status).toBe(400);
  });
});
