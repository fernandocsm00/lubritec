import { describe, it, expect } from 'vitest';
import { db } from '../db/client';
import { deals } from '../db/schema';
import { eq } from 'drizzle-orm';
import { createDeal, getDealByLeadId, changeStage } from '../services/dealsService';
import { createUser, createLead, createDeal as insertDeal } from './helpers';

// Modelo de recompra: lead = conta, deal = ciclo de venda. Um lead pode ter
// vários deals (histórico), mas no máximo 1 ATIVO. Cliente que já teve venda
// 'ganho' e volta vira um NOVO card (manual, em em_negociacao), preservando a
// venda anterior. Ver migration 036.

let seq = 0;
async function seedUserLead() {
  seq += 1;
  const u = await createUser({ email: `rc${seq}@x.com`, password: 'pw12345', role: 'comercial' });
  const lead = await createLead({ phone: `1100009${String(seq).padStart(4, '0')}` });
  return { userId: u.id, leadId: lead.id };
}

describe('createDeal — múltiplos ciclos por lead (recompra)', () => {
  it('primeiro deal manual entra em lead_no_comercial', async () => {
    const { userId, leadId } = await seedUserLead();
    const d = await createDeal({ leadId, ownerUserId: userId, source: 'manual' });
    expect(d.stage).toBe('lead_no_comercial');
  });

  it('idempotência do ATIVO: 2ª chamada devolve o mesmo card (1 deal no banco)', async () => {
    const { userId, leadId } = await seedUserLead();
    const d1 = await createDeal({ leadId, ownerUserId: userId, source: 'manual' });
    const d2 = await createDeal({ leadId, ownerUserId: userId, source: 'manual' });
    expect(d2.id).toBe(d1.id);
    const rows = await db.select().from(deals).where(eq(deals.leadId, leadId));
    expect(rows).toHaveLength(1);
  });

  it('recompra MANUAL com deal ganho: cria NOVO card em em_negociacao; ganho preservado', async () => {
    const { userId, leadId } = await seedUserLead();
    await insertDeal({ leadId, stage: 'ganho', proposalValue: 500, ownerUserId: userId, closedAt: new Date() });
    const novo = await createDeal({ leadId, ownerUserId: userId, source: 'manual' });
    expect(novo.stage).toBe('em_negociacao');
    const rows = await db.select().from(deals).where(eq(deals.leadId, leadId));
    expect(rows).toHaveLength(2);
    // A venda anterior continua registrada como 'ganho'.
    expect(rows.some((r) => r.stage === 'ganho')).toBe(true);
  });

  it('recompra por IA/auto NÃO recria ciclo — devolve o último card (evita card fantasma)', async () => {
    const { userId, leadId } = await seedUserLead();
    const ganho = await insertDeal({ leadId, stage: 'ganho', proposalValue: 500, ownerUserId: userId, closedAt: new Date() });
    const r = await createDeal({ leadId, ownerUserId: null, source: 'ai_qualified' });
    expect(r.id).toBe(ganho.id);
    const rows = await db.select().from(deals).where(eq(deals.leadId, leadId));
    expect(rows).toHaveLength(1);
  });

  it('getDealByLeadId prefere o card ATIVO quando há ganho + ativo', async () => {
    const { userId, leadId } = await seedUserLead();
    await insertDeal({ leadId, stage: 'ganho', proposalValue: 500, ownerUserId: userId, closedAt: new Date() });
    const ativo = await createDeal({ leadId, ownerUserId: userId, source: 'manual' }); // em_negociacao
    const found = await getDealByLeadId(leadId);
    expect(found?.id).toBe(ativo.id);
    expect(found?.stage).toBe('em_negociacao');
  });

  it('reabrir card ganho com outro card ATIVO no lead → 409 (não estoura unique_violation)', async () => {
    const { userId, leadId } = await seedUserLead();
    const ganho = await insertDeal({ leadId, stage: 'ganho', proposalValue: 500, ownerUserId: userId, closedAt: new Date() });
    await createDeal({ leadId, ownerUserId: userId, source: 'manual' }); // cria ativo em_negociacao
    await expect(
      changeStage({ id: ganho.id, actorUserId: userId, stage: 'em_negociacao' }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
