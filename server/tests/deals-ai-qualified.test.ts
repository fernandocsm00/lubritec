import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/client';
import { leads, deals } from '../db/schema';
import { createDeal } from '../services/dealsService';
import { eq } from 'drizzle-orm';

describe('createDeal — source ai_qualified (sem owner)', () => {
  let leadId: string;
  beforeEach(async () => {
    const [l] = await db.insert(leads).values({ name: 'Lead AI Qual', phone: '5511000000300' })
      .returning({ id: leads.id });
    leadId = l.id;
  });

  it('cria deal com ownerUserId=null e source=ai_qualified', async () => {
    const deal = await createDeal({ leadId, ownerUserId: null, source: 'ai_qualified' });
    expect(deal.stage).toBe('lead_no_comercial');
    expect(deal.owner).toBeNull();
    const [row] = await db.select().from(deals).where(eq(deals.id, deal.id)).limit(1);
    expect(row.ownerUserId).toBeNull();
  });

  it('e idempotente (segundo call retorna o mesmo deal)', async () => {
    const d1 = await createDeal({ leadId, ownerUserId: null, source: 'ai_qualified' });
    const d2 = await createDeal({ leadId, ownerUserId: null, source: 'ai_qualified' });
    expect(d1.id).toBe(d2.id);
  });
});
