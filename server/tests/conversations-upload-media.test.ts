import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { createUser } from './helpers';

// Anexo cujo nome não traz extensão (comum em mobile/share-sheet) caía em `.bin`
// no multer → express.static servia application/octet-stream → Meta/UazAPI
// buscavam a URL e descartavam a imagem (parecia enviada). validateUploadMagicBytes
// agora renomeia pra extensão canônica do conteúdo REAL detectado.

const app = createApp();

// PNG 1x1 real (magic bytes) — file-type detecta como image/png.
const TINY_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63000100000005000100' +
  '0d0a2db40000000049454e44ae426082',
  'hex',
);

async function login() {
  await createUser({ email: 'up@x.com', password: 'pw12345', role: 'comercial' });
  const res = await request(app).post('/api/auth/login').send({ email: 'up@x.com', password: 'pw12345' });
  return res.body.accessToken as string;
}

describe('POST /api/conversations/upload-media — extensão normalizada pelo conteúdo', () => {
  it('anexo SEM extensão (image/png) vira .png e é servido como image/png', async () => {
    const token = await login();
    const res = await request(app)
      .post('/api/conversations/upload-media')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', TINY_PNG, { filename: 'screenshot', contentType: 'image/png' });

    expect(res.status).toBe(200);
    // Antes do fix vinha `.bin`; agora .png (canônico do mime detectado).
    expect(res.body.mediaUrl).toMatch(/^\/uploads\/conversations\/[a-f0-9]{32}\.png$/);

    // Content-Type servido é o que o provider realmente busca — precisa ser image/png.
    const fileRes = await request(app).get(res.body.mediaUrl);
    expect(fileRes.status).toBe(200);
    expect(fileRes.headers['content-type']).toMatch(/^image\/png/);
  });

  it('anexo com extensão correta (.png) permanece .png', async () => {
    const token = await login();
    const res = await request(app)
      .post('/api/conversations/upload-media')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', TINY_PNG, { filename: 'foto.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    expect(res.body.mediaUrl).toMatch(/^\/uploads\/conversations\/[a-f0-9]{32}\.png$/);
  });

  it('extensão errada mas permitida (.gif p/ conteúdo png) é corrigida pra .png', async () => {
    const token = await login();
    const res = await request(app)
      .post('/api/conversations/upload-media')
      .set('Authorization', `Bearer ${token}`)
      // declara image/png (bate categoria) mas nome tem .gif — express serviria
      // image/gif (errado). O fix normaliza pra .png pelo conteúdo detectado.
      .attach('file', TINY_PNG, { filename: 'wrong.gif', contentType: 'image/png' });

    expect(res.status).toBe(200);
    expect(res.body.mediaUrl).toMatch(/^\/uploads\/conversations\/[a-f0-9]{32}\.png$/);
  });
});
