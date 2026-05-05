import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../app';
import { db } from '../db/client';
import { notifications } from '../db/schema';
import {
  emitNotification,
  listNotifications,
  unreadCountFor,
  markRead,
  markAllRead,
} from '../services/notifications';
import { createUser } from './helpers';

const app = createApp();

async function loginAs(opts: { email: string; role?: 'admin' | 'comercial' | 'recepcao' } = { email: 'r@x.com' }) {
  const u = await createUser({ email: opts.email, password: 'pw12345', role: opts.role ?? 'recepcao' });
  const res = await request(app).post('/api/auth/login').send({ email: u.email, password: 'pw12345' });
  return { token: res.body.accessToken as string, userId: u.id };
}

describe('emitNotification', () => {
  it('cria notification pra cada userId fornecido', async () => {
    const u1 = await createUser({ email: 'u1@x.com', role: 'admin' });
    const u2 = await createUser({ email: 'u2@x.com', role: 'admin' });

    await emitNotification({
      userIds: [u1.id, u2.id],
      kind: 'system',
      title: 'Teste',
      body: 'corpo',
    });

    const all = await db.select().from(notifications);
    expect(all).toHaveLength(2);
  });

  it('broadcast por roles cria pra todos os usuários ativos das roles listadas', async () => {
    await createUser({ email: 'a@x.com', role: 'admin' });
    await createUser({ email: 'c@x.com', role: 'comercial' });
    await createUser({ email: 'r@x.com', role: 'recepcao' });
    await createUser({ email: 'inactive@x.com', role: 'admin', isActive: false });

    await emitNotification({
      toRoles: ['admin', 'comercial'],
      kind: 'lead_qualified',
      title: 'Lead qualificado',
      body: 'X',
    });

    const all = await db.select().from(notifications);
    // admin (ativo) + comercial = 2 (não conta o admin inativo)
    expect(all).toHaveLength(2);
  });

  it('best-effort: erros não propagam', async () => {
    await expect(emitNotification({
      userIds: ['00000000-0000-0000-0000-000000000000'],
      kind: 'system',
      title: 'X',
      body: 'Y',
    })).resolves.toBeUndefined();
  });

  it('no-op quando nem userIds nem toRoles', async () => {
    await emitNotification({ kind: 'system', title: 'X', body: 'Y' });
    const all = await db.select().from(notifications);
    expect(all).toHaveLength(0);
  });
});

describe('listNotifications + unreadCountFor', () => {
  it('lista mais recente primeiro + count de unread', async () => {
    const u = await createUser({ email: 'u@x.com', role: 'admin' });
    await emitNotification({ userIds: [u.id], kind: 'system', title: 'A', body: 'a' });
    await new Promise((r) => setTimeout(r, 10));
    await emitNotification({ userIds: [u.id], kind: 'system', title: 'B', body: 'b' });

    const list = await listNotifications(u.id);
    expect(list.items).toHaveLength(2);
    expect(list.items[0].title).toBe('B'); // mais recente primeiro
    expect(list.unreadCount).toBe(2);

    const count = await unreadCountFor(u.id);
    expect(count).toBe(2);
  });

  it('usuário só vê suas próprias notificações', async () => {
    const u1 = await createUser({ email: 'u1@x.com' });
    const u2 = await createUser({ email: 'u2@x.com' });
    await emitNotification({ userIds: [u1.id], kind: 'system', title: 'pra u1', body: '' });
    await emitNotification({ userIds: [u2.id], kind: 'system', title: 'pra u2', body: '' });

    const list1 = await listNotifications(u1.id);
    expect(list1.items).toHaveLength(1);
    expect(list1.items[0].title).toBe('pra u1');
  });
});

describe('markRead + markAllRead', () => {
  it('markRead seta read_at de uma notification específica', async () => {
    const u = await createUser({ email: 'u@x.com' });
    await emitNotification({ userIds: [u.id], kind: 'system', title: 'A', body: '' });
    await emitNotification({ userIds: [u.id], kind: 'system', title: 'B', body: '' });

    const list = await listNotifications(u.id);
    expect(list.unreadCount).toBe(2);

    await markRead(u.id, list.items[0].id);
    const after = await listNotifications(u.id);
    expect(after.unreadCount).toBe(1);
  });

  it('markRead não permite marcar notification de outro usuário', async () => {
    const u1 = await createUser({ email: 'u1@x.com' });
    const u2 = await createUser({ email: 'u2@x.com' });
    await emitNotification({ userIds: [u1.id], kind: 'system', title: 'X', body: '' });
    const [n] = await db.select().from(notifications);

    await markRead(u2.id, n.id); // u2 tentando marcar nota de u1 — no-op
    const list = await listNotifications(u1.id);
    expect(list.unreadCount).toBe(1); // ainda não lida
  });

  it('markAllRead marca tudo do usuário', async () => {
    const u = await createUser({ email: 'u@x.com' });
    for (let i = 0; i < 5; i++) {
      await emitNotification({ userIds: [u.id], kind: 'system', title: `${i}`, body: '' });
    }
    const r = await markAllRead(u.id);
    expect(r.marked).toBe(5);
    const after = await unreadCountFor(u.id);
    expect(after).toBe(0);
  });
});

describe('REST endpoints', () => {
  it('GET /api/notifications retorna lista do usuário logado', async () => {
    const { token, userId } = await loginAs();
    await emitNotification({ userIds: [userId], kind: 'system', title: 'Z', body: '' });

    const r = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body.items).toHaveLength(1);
    expect(r.body.unreadCount).toBe(1);
  });

  it('GET /api/notifications/unread-count', async () => {
    const { token, userId } = await loginAs();
    await emitNotification({ userIds: [userId], kind: 'system', title: 'Z', body: '' });
    await emitNotification({ userIds: [userId], kind: 'system', title: 'W', body: '' });

    const r = await request(app)
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body.unreadCount).toBe(2);
  });

  it('POST /api/notifications/:id/read', async () => {
    const { token, userId } = await loginAs();
    await emitNotification({ userIds: [userId], kind: 'system', title: 'Z', body: '' });
    const [n] = await db.select().from(notifications).where(eq(notifications.userId, userId));

    const r = await request(app)
      .post(`/api/notifications/${n.id}/read`)
      .set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(204);

    const [updated] = await db.select().from(notifications).where(eq(notifications.id, n.id));
    expect(updated.readAt).not.toBeNull();
  });

  it('POST /api/notifications/read-all', async () => {
    const { token, userId } = await loginAs();
    for (let i = 0; i < 3; i++) {
      await emitNotification({ userIds: [userId], kind: 'system', title: `${i}`, body: '' });
    }
    const r = await request(app)
      .post('/api/notifications/read-all')
      .set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body.marked).toBe(3);
  });

  it('401 sem token', async () => {
    const r = await request(app).get('/api/notifications');
    expect(r.status).toBe(401);
  });
});
