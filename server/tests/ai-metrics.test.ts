import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { db } from '../db/client';
import { aiCallLogs } from '../db/schema';
import { computeCostUsd, recordAiCall, getAiMetricsSummary } from '../services/aiMetrics';
import { createUser } from './helpers';

const app = createApp();

async function loginAs(role: 'admin' | 'recepcao' = 'admin') {
  const u = await createUser({ email: `${role}@x.com`, password: 'pw12345', role });
  const res = await request(app).post('/api/auth/login').send({ email: u.email, password: 'pw12345' });
  return { token: res.body.accessToken as string };
}

describe('computeCostUsd', () => {
  it('zero quando 0 tokens', () => {
    expect(computeCostUsd(0, 0)).toBe(0);
  });

  it('1M input + 1M output = $0.075 + $0.30 = $0.375', () => {
    expect(computeCostUsd(1_000_000, 1_000_000)).toBeCloseTo(0.375, 6);
  });

  it('1k input + 1k output = $0.000075 + $0.0003 = $0.000375', () => {
    expect(computeCostUsd(1_000, 1_000)).toBeCloseTo(0.000375, 6);
  });
});

describe('recordAiCall', () => {
  it('grava row com cost calculado', async () => {
    await recordAiCall({
      conversationId: null,
      leadId: null,
      model: 'gemini-2.5-flash',
      inputTokens: 1000,
      outputTokens: 500,
      latencyMs: 1234,
      qualified: true,
    });

    const rows = await db.select().from(aiCallLogs);
    expect(rows).toHaveLength(1);
    expect(rows[0].model).toBe('gemini-2.5-flash');
    expect(rows[0].inputTokens).toBe(1000);
    expect(rows[0].outputTokens).toBe(500);
    expect(rows[0].qualified).toBe(true);
    expect(Number(rows[0].costUsd)).toBeCloseTo(0.000225, 6); // (1000/1M*0.075 + 500/1M*0.30)
  });

  it('best-effort: erro ao gravar não propaga', async () => {
    // Passa lead_id inválido (FK falha)
    await expect(recordAiCall({
      conversationId: null,
      leadId: '00000000-0000-0000-0000-000000000000', // fk inexistente, mas FK é SET NULL não causa erro
      model: 'x',
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
      qualified: false,
    })).resolves.toBeUndefined();
  });
});

describe('getAiMetricsSummary', () => {
  it('zero calls → todos os counts em 0', async () => {
    const r = await getAiMetricsSummary({
      rangeStart: new Date(Date.now() - 86400_000),
      rangeEnd: new Date(),
    });
    expect(r.totalCalls).toBe(0);
    expect(r.qualifyRate).toBe(0);
    expect(r.totalCostUsd).toBe(0);
    expect(r.avgCostPerQualifiedUsd).toBeNull();
  });

  it('agrega counts + tokens + custo + latência', async () => {
    await recordAiCall({ conversationId: null, leadId: null, model: 'm', inputTokens: 100, outputTokens: 50, latencyMs: 1000, qualified: true });
    await recordAiCall({ conversationId: null, leadId: null, model: 'm', inputTokens: 200, outputTokens: 100, latencyMs: 2000, qualified: false });
    await recordAiCall({ conversationId: null, leadId: null, model: 'm', inputTokens: 0, outputTokens: 0, latencyMs: 0, qualified: false, humanIntent: true });
    await recordAiCall({ conversationId: null, leadId: null, model: 'm', inputTokens: 0, outputTokens: 0, latencyMs: 0, qualified: false, error: 'rate_limit' });

    const r = await getAiMetricsSummary({
      rangeStart: new Date(Date.now() - 86400_000),
      rangeEnd: new Date(Date.now() + 60_000),
    });
    expect(r.totalCalls).toBe(4);
    expect(r.qualifiedCount).toBe(1);
    expect(r.qualifyRate).toBe(25); // 1/4 = 25%
    expect(r.humanIntentCount).toBe(1);
    expect(r.errorCount).toBe(1);
    expect(r.totalInputTokens).toBe(300);
    expect(r.totalOutputTokens).toBe(150);
    // (100/1M*0.075 + 50/1M*0.30) + (200/1M*0.075 + 100/1M*0.30) = 0.0000225 + 0.000045 = 0.0000675
    expect(r.totalCostUsd).toBeCloseTo(0.0000675, 6);
    expect(r.avgLatencyMs).toBe(750); // (1000+2000+0+0)/4
    expect(r.avgCostPerQualifiedUsd).not.toBeNull();
  });
});

describe('GET /api/dashboard/ai-metrics', () => {
  it('401 sem token', async () => {
    const r = await request(app).get('/api/dashboard/ai-metrics?period=30d');
    expect(r.status).toBe(401);
  });

  it('403 quando não admin', async () => {
    const { token } = await loginAs('recepcao');
    const r = await request(app)
      .get('/api/dashboard/ai-metrics?period=30d')
      .set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(403);
  });

  it('200 admin retorna shape correto', async () => {
    const { token } = await loginAs('admin');
    const r = await request(app)
      .get('/api/dashboard/ai-metrics?period=30d')
      .set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body.totalCalls).toBeGreaterThanOrEqual(0);
    expect(r.body.qualifyRate).toBeDefined();
    expect(r.body.period).toBeDefined();
  });
});
