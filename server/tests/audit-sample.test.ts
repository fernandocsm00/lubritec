import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/client';
import { auditSampleAssignments, leads, users, campaigns, whatsappInstance } from '../db/schema';
import {
  enrollIfSampled, claimNextSample, recordOutcome, AUDIT_SAMPLE_RATE,
} from '../services/auditSampleService';
import { eq } from 'drizzle-orm';

describe('audit sample service', () => {
  let leadId: string; let userId: string; let campaignId: string;

  beforeEach(async () => {
    const [inst] = await db.insert(whatsappInstance).values({
      provider: 'uazapi', displayName: 'i', providerConfig: {},
    }).returning({ id: whatsappInstance.id });
    const [u] = await db.insert(users).values({
      email: `audit-${Date.now()}@x.com`, name: 'V', role: 'comercial', passwordHash: 'x',
    }).returning({ id: users.id });
    userId = u.id;
    const [l] = await db.insert(leads).values({ name: 'Lead A', phone: '5511000000099' })
      .returning({ id: leads.id });
    leadId = l.id;
    const [c] = await db.insert(campaigns).values({
      name: 'Camp', messageBody: 'oi', createdByUserId: userId, instanceId: inst.id,
    }).returning({ id: campaigns.id });
    campaignId = c.id;
  });

  it('AUDIT_SAMPLE_RATE = 0.10', () => {
    expect(AUDIT_SAMPLE_RATE).toBe(0.10);
  });

  it('enrollIfSampled cria assignment quando força sampling', async () => {
    // forceSample bypass do random — usado em testes
    await enrollIfSampled({ leadId, campaignId, aiCallLogId: null, forceSample: true });
    const [row] = await db.select().from(auditSampleAssignments).where(eq(auditSampleAssignments.leadId, leadId)).limit(1);
    expect(row).toBeDefined();
    expect(row.status).toBe('pending');
    expect(row.campaignId).toBe(campaignId);
  });

  it('enrollIfSampled é idempotente (unique no leadId)', async () => {
    await enrollIfSampled({ leadId, campaignId, aiCallLogId: null, forceSample: true });
    await enrollIfSampled({ leadId, campaignId, aiCallLogId: null, forceSample: true });
    // Não deve lançar; segundo é no-op
    const rows = await db.select().from(auditSampleAssignments).where(eq(auditSampleAssignments.leadId, leadId));
    expect(rows.length).toBe(1);
  });

  it('claimNextSample atribui pra usuário', async () => {
    await enrollIfSampled({ leadId, campaignId, aiCallLogId: null, forceSample: true });
    const claimed = await claimNextSample({ userId, campaignId });
    expect(claimed).not.toBeNull();
    expect(claimed!.leadId).toBe(leadId);
    expect(claimed!.assignedTo?.id).toBe(userId);
  });

  it('recordOutcome marca como contacted com outcome', async () => {
    await enrollIfSampled({ leadId, campaignId, aiCallLogId: null, forceSample: true });
    const claimed = await claimNextSample({ userId, campaignId });
    await recordOutcome({ id: claimed!.id, outcome: 'good', userId, notes: 'achou interessante' });
    const [row] = await db.select().from(auditSampleAssignments).where(eq(auditSampleAssignments.id, claimed!.id)).limit(1);
    expect(row.status).toBe('contacted');
    expect(row.outcome).toBe('good');
    expect(row.outcomeNotes).toBe('achou interessante');
  });
});
