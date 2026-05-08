import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/client';
import {
  campaigns,
  campaignRecipients,
  notifications,
} from '../db/schema';
import { eq } from 'drizzle-orm';
import {
  createUser,
  createLead,
} from './helpers';
import { tick } from '../services/campaignsDispatcher';

async function createCampaignRow(input: { audienceTotal: number; userId: string }) {
  const [c] = await db.insert(campaigns).values({
    name: 'cool-notif',
    status: 'running',
    messageBody: 'oi',
    audienceTotal: input.audienceTotal,
    createdByUserId: input.userId,
    ratePerMinute: 1000,
  }).returning();
  return c;
}

describe('campaign cooldown notification', () => {
  beforeEach(async () => {
    await db.delete(notifications);
  });

  it('cria notificação campaign_cooldown_high quando >10% pulado por cooldown', async () => {
    const admin = await createUser({ role: 'admin', email: 'na@x.com' });
    const u = await createUser({ role: 'comercial', email: 'nu@x.com' });
    const camp = await createCampaignRow({ audienceTotal: 10, userId: u.id });

    // 8 sent (não pulados), 2 skipped por cooldown (=20% > 10%).
    for (let i = 0; i < 8; i++) {
      const lead = await createLead({ phone: `551190009${String(i).padStart(4, '0')}` });
      await db.insert(campaignRecipients).values({
        campaignId: camp.id, leadId: lead.id, phone: lead.phone!, status: 'sent',
      });
    }
    for (let i = 0; i < 2; i++) {
      const lead = await createLead({ phone: `551190009${String(i + 100).padStart(4, '0')}` });
      await db.insert(campaignRecipients).values({
        campaignId: camp.id, leadId: lead.id, phone: lead.phone!,
        status: 'skipped', failureReason: 'cooldown_24h',
      });
    }
    await db.update(campaigns).set({ skippedCount: 2, sentCount: 8 })
      .where(eq(campaigns.id, camp.id));

    await tick();

    const notifs = await db.select().from(notifications)
      .where(eq(notifications.userId, admin.id));
    expect(notifs).toHaveLength(1);
    expect(notifs[0].kind).toBe('campaign_cooldown_high');

    const [after] = await db.select().from(campaigns).where(eq(campaigns.id, camp.id));
    expect(after.cooldownAlertSentAt).not.toBeNull();
  });

  it('idempotência: tick subsequente não duplica', async () => {
    const admin = await createUser({ role: 'admin', email: 'na2@x.com' });
    const u = await createUser({ role: 'comercial', email: 'nu2@x.com' });
    const camp = await createCampaignRow({ audienceTotal: 10, userId: u.id });
    for (let i = 0; i < 8; i++) {
      const lead = await createLead({ phone: `551190019${String(i).padStart(4, '0')}` });
      await db.insert(campaignRecipients).values({
        campaignId: camp.id, leadId: lead.id, phone: lead.phone!, status: 'sent',
      });
    }
    for (let i = 0; i < 2; i++) {
      const lead = await createLead({ phone: `551190019${String(i + 100).padStart(4, '0')}` });
      await db.insert(campaignRecipients).values({
        campaignId: camp.id, leadId: lead.id, phone: lead.phone!,
        status: 'skipped', failureReason: 'cooldown_24h',
      });
    }
    await db.update(campaigns).set({ skippedCount: 2, sentCount: 8 })
      .where(eq(campaigns.id, camp.id));

    await tick();
    await tick();

    const notifs = await db.select().from(notifications)
      .where(eq(notifications.userId, admin.id));
    expect(notifs).toHaveLength(1);
  });

  it('não dispara quando ratio <= 10%', async () => {
    const admin = await createUser({ role: 'admin', email: 'na3@x.com' });
    const u = await createUser({ role: 'comercial', email: 'nu3@x.com' });
    const camp = await createCampaignRow({ audienceTotal: 100, userId: u.id });
    for (let i = 0; i < 5; i++) {
      const lead = await createLead({ phone: `551190029${String(i).padStart(4, '0')}` });
      await db.insert(campaignRecipients).values({
        campaignId: camp.id, leadId: lead.id, phone: lead.phone!,
        status: 'skipped', failureReason: 'cooldown_24h',
      });
    }
    await db.update(campaigns).set({ skippedCount: 5 })
      .where(eq(campaigns.id, camp.id));

    await tick();

    const notifs = await db.select().from(notifications)
      .where(eq(notifications.userId, admin.id));
    expect(notifs).toHaveLength(0);
  });
});
