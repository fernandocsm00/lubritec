import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/client';
import { orgSettings } from '../db/schema';
import { getOrgSettings, updateOrgSettings } from '../services/orgSettingsService';

describe('orgSettingsService', () => {
  beforeEach(async () => {
    // beforeEach in setup.ts truncates business tables but NOT org_settings (singleton).
    // Reset goal to null so each test starts clean.
    await db.update(orgSettings).set({ monthlySalesGoal: null });
  });

  it('returns current settings (null goal by default)', async () => {
    const r = await getOrgSettings();
    expect(r.monthlySalesGoal).toBeNull();
    expect(typeof r.updatedAt).toBe('string');
  });

  it('updates monthly sales goal', async () => {
    const r = await updateOrgSettings({ monthlySalesGoal: 75000 });
    expect(r.monthlySalesGoal).toBe(75000);
  });

  it('clears the goal when null is passed', async () => {
    await updateOrgSettings({ monthlySalesGoal: 50000 });
    const r = await updateOrgSettings({ monthlySalesGoal: null });
    expect(r.monthlySalesGoal).toBeNull();
  });

  it('rejects negative goal', async () => {
    await expect(updateOrgSettings({ monthlySalesGoal: -1 })).rejects.toThrow();
  });
});

import request from 'supertest';
import { createApp } from '../app';
import { createUser } from './helpers';
import { signAccessToken } from '../lib/jwt';

describe('org-settings HTTP', () => {
  it('GET /api/org-settings returns current settings (any authenticated)', async () => {
    const app = createApp();
    const u = await createUser({ role: 'comercial' });
    const token = signAccessToken({ userId: u.id, role: u.role });
    const r = await request(app).get('/api/org-settings').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('monthlySalesGoal');
    expect(r.body).toHaveProperty('updatedAt');
  });

  it('PUT /api/org-settings rejects comercial (403)', async () => {
    const app = createApp();
    const u = await createUser({ role: 'comercial' });
    const token = signAccessToken({ userId: u.id, role: u.role });
    const r = await request(app).put('/api/org-settings')
      .set('Authorization', `Bearer ${token}`).send({ monthlySalesGoal: 1000 });
    expect(r.status).toBe(403);
  });

  it('PUT /api/org-settings allows admin and persists value', async () => {
    const app = createApp();
    const u = await createUser({ role: 'admin' });
    const token = signAccessToken({ userId: u.id, role: u.role });
    const r = await request(app).put('/api/org-settings')
      .set('Authorization', `Bearer ${token}`).send({ monthlySalesGoal: 75000 });
    expect(r.status).toBe(200);
    expect(r.body.monthlySalesGoal).toBe(75000);
  });

  it('PUT validates schema (rejects negative)', async () => {
    const app = createApp();
    const u = await createUser({ role: 'admin' });
    const token = signAccessToken({ userId: u.id, role: u.role });
    const r = await request(app).put('/api/org-settings')
      .set('Authorization', `Bearer ${token}`).send({ monthlySalesGoal: -5 });
    expect(r.status).toBe(400);
  });

  it('aceita e persiste os limiares de pendência de resposta', async () => {
    const app = createApp();
    const u = await createUser({ role: 'admin' });
    const token = signAccessToken({ userId: u.id, role: u.role });

    const res = await request(app)
      .put('/api/org-settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ pendingReplyAlertMin: 45, pendingReplyEscalateMin: 120 });

    expect(res.status).toBe(200);
    expect(res.body.pendingReplyAlertMin).toBe(45);
    expect(res.body.pendingReplyEscalateMin).toBe(120);
  });

  it('rejeita limiar não positivo', async () => {
    const app = createApp();
    const u = await createUser({ role: 'admin' });
    const token = signAccessToken({ userId: u.id, role: u.role });

    const res = await request(app)
      .put('/api/org-settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ pendingReplyAlertMin: 0 });

    expect(res.status).toBe(400);
  });

  it('rejeita escalate menor ou igual ao alert já armazenado, e não persiste nada', async () => {
    const app = createApp();
    const u = await createUser({ role: 'admin' });
    const token = signAccessToken({ userId: u.id, role: u.role });

    // Estabelece um estado conhecido: alert=60, escalate=180.
    const setup = await request(app)
      .put('/api/org-settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ pendingReplyAlertMin: 60, pendingReplyEscalateMin: 180 });
    expect(setup.status).toBe(200);

    // PUT manda só o escalate, menor que o alert já salvo (60) — deve
    // comparar contra o valor armazenado (merged), não só o body recebido.
    const res = await request(app)
      .put('/api/org-settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ pendingReplyEscalateMin: 30 });

    expect(res.status).toBe(400);

    const after = await request(app)
      .get('/api/org-settings')
      .set('Authorization', `Bearer ${token}`);
    expect(after.body.pendingReplyAlertMin).toBe(60);
    expect(after.body.pendingReplyEscalateMin).toBe(180);
  });
});
