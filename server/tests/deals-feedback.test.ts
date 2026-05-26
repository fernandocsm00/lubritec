import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/client';
import { leads, deals, users, dealActivities } from '../db/schema';
import { changeStage, createDeal } from '../services/dealsService';
import { eq } from 'drizzle-orm';
import { HttpError } from '../middleware/errorHandler';

describe('changeStage — leadQualityFeedback', () => {
  let leadId: string; let userId: string; let dealId: string;

  beforeEach(async () => {
    const [u] = await db.insert(users).values({
      email: `test-${Date.now()}@x.com`, name: 'Vendedor', role: 'comercial', passwordHash: 'x',
    }).returning({ id: users.id });
    userId = u.id;
    const [l] = await db.insert(leads).values({ name: 'Lead FB', phone: '5511000000000' })
      .returning({ id: leads.id });
    leadId = l.id;
    const d = await createDeal({ leadId, ownerUserId: userId, source: 'manual', proposalValue: 1000 });
    dealId = d.id;
  });

  it('exige leadQualityFeedback ao mover pra ganho', async () => {
    await expect(
      changeStage({ id: dealId, actorUserId: userId, stage: 'ganho' /* missing feedback */ }),
    ).rejects.toThrow(/leadQualityFeedback is required/);
  });

  it('grava leadQualityFeedback ao mover pra ganho', async () => {
    const updated = await changeStage({
      id: dealId, actorUserId: userId, stage: 'ganho', leadQualityFeedback: 'good',
    });
    expect(updated.stage).toBe('ganho');
    const [row] = await db.select().from(deals).where(eq(deals.id, dealId)).limit(1);
    expect(row.leadQualityFeedback).toBe('good');
    expect(row.leadQualityFeedbackBy).toBe(userId);
    expect(row.leadQualityFeedbackAt).toBeInstanceOf(Date);
  });

  it('grava leadQualityFeedback ao mover pra perdido', async () => {
    const updated = await changeStage({
      id: dealId, actorUserId: userId, stage: 'perdido',
      lossReason: 'preco', leadQualityFeedback: 'bad',
    });
    expect(updated.stage).toBe('perdido');
    const [row] = await db.select().from(deals).where(eq(deals.id, dealId)).limit(1);
    expect(row.leadQualityFeedback).toBe('bad');
  });

  it('registra activity quality_feedback', async () => {
    await changeStage({
      id: dealId, actorUserId: userId, stage: 'ganho', leadQualityFeedback: 'good',
    });
    const acts = await db.select().from(dealActivities).where(eq(dealActivities.dealId, dealId));
    const fbAct = acts.find((a) => a.kind === 'quality_feedback');
    expect(fbAct).toBeDefined();
    expect((fbAct?.metadata as { feedback: string }).feedback).toBe('good');
  });
});
