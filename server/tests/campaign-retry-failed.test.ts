import { describe, it, expect } from 'vitest';
import { db } from '../db/client';
import { campaignRecipients, campaigns } from '../db/schema';
import { eq } from 'drizzle-orm';
import { createUser, createLead, createCampaign, createCampaignRecipient } from './helpers';
import { retryFailedRecipients } from '../services/campaignsService';
import { INTERRUPTED_MID_SEND_REASON } from '../services/campaignsDispatcher';
import type { CampaignStatus } from '@shared/types';

let seq = 0;

async function campaignWith(status: CampaignStatus, failedCount = 0) {
  const u = await createUser({ email: `rf${++seq}@x.com`, role: 'admin' });
  return createCampaign({
    createdByUserId: u.id,
    status,
    failedCount,
    completedAt: status === 'completed' ? new Date() : null,
  });
}

async function failedRecipient(campaignId: string, reason: string) {
  const lead = await createLead({});
  return createCampaignRecipient({
    campaignId,
    leadId: lead.id,
    status: 'failed',
    failureReason: reason,
  });
}

const recipient = async (id: string) =>
  (await db.select().from(campaignRecipients).where(eq(campaignRecipients.id, id)))[0];
const campaign = async (id: string) =>
  (await db.select().from(campaigns).where(eq(campaigns.id, id)))[0];

describe('retryFailedRecipients', () => {
  it('devolve para pending a falha que comprovadamente não saiu', async () => {
    const c = await campaignWith('completed', 1);
    const r = await failedRecipient(c.id, 'entrega recusada pelo provedor — 131026');

    const res = await retryFailedRecipients(c.id);

    expect(res.requeued).toBe(1);
    expect((await recipient(r.id)).status).toBe('pending');
  });

  it('zera o backoff e o motivo da falha ao reenfileirar', async () => {
    const c = await campaignWith('completed', 1);
    const r = await failedRecipient(c.id, 'UazAPI error 400: bad request');
    await db.update(campaignRecipients)
      .set({ attemptCount: 3, nextAttemptAt: new Date(Date.now() + 3_600_000) })
      .where(eq(campaignRecipients.id, r.id));

    await retryFailedRecipients(c.id);

    const row = await recipient(r.id);
    expect(row.attemptCount).toBe(0);
    expect(row.nextAttemptAt).toBeNull();
    expect(row.failureReason).toBeNull();
  });

  it('não reenfileira o disparo interrompido no meio do envio', async () => {
    // Pode ter sido entregue antes do processo morrer — reenviar duplicaria a
    // mensagem pro cliente, que é risco de ban do chip.
    const c = await campaignWith('completed', 1);
    const r = await failedRecipient(c.id, INTERRUPTED_MID_SEND_REASON);

    const res = await retryFailedRecipients(c.id);

    expect(res.requeued).toBe(0);
    expect(res.skippedInterrupted).toBe(1);
    expect((await recipient(r.id)).status).toBe('failed');
  });

  it('desconta do failedCount só o que foi reenfileirado', async () => {
    const c = await campaignWith('completed', 5);
    await failedRecipient(c.id, 'UazAPI error 400');
    await failedRecipient(c.id, 'entrega recusada pelo provedor — 131026');
    await failedRecipient(c.id, INTERRUPTED_MID_SEND_REASON);

    await retryFailedRecipients(c.id);

    expect((await campaign(c.id)).failedCount).toBe(3);
  });

  it('reabre a campanha concluída para running e limpa completedAt', async () => {
    const c = await campaignWith('completed', 1);
    await failedRecipient(c.id, 'UazAPI error 400');

    await retryFailedRecipients(c.id);

    const row = await campaign(c.id);
    expect(row.status).toBe('running');
    expect(row.completedAt).toBeNull();
  });

  it('retoma a campanha pausada', async () => {
    const c = await campaignWith('paused', 1);
    await failedRecipient(c.id, 'UazAPI error 400');

    await retryFailedRecipients(c.id);

    expect((await campaign(c.id)).status).toBe('running');
  });

  it('não mexe no status da campanha quando não há nada elegível', async () => {
    const c = await campaignWith('completed', 1);
    await failedRecipient(c.id, INTERRUPTED_MID_SEND_REASON);

    await retryFailedRecipients(c.id);

    expect((await campaign(c.id)).status).toBe('completed');
  });

  it('recusa campanha cancelada', async () => {
    const c = await campaignWith('cancelled', 1);
    await failedRecipient(c.id, 'UazAPI error 400');

    await expect(retryFailedRecipients(c.id)).rejects.toThrow(/cancelled|cancelada/i);
  });

  it('recusa campanha em rascunho', async () => {
    const c = await campaignWith('draft', 0);

    await expect(retryFailedRecipients(c.id)).rejects.toThrow(/draft|rascunho/i);
  });

  it('404 para campanha inexistente', async () => {
    await expect(
      retryFailedRecipients('00000000-0000-0000-0000-000000000000'),
    ).rejects.toThrow(/not found/i);
  });

  it('não toca em destinatários enviados, pulados ou pendentes', async () => {
    const c = await campaignWith('completed', 0);
    const l1 = await createLead({});
    const l2 = await createLead({});
    const sent = await createCampaignRecipient({ campaignId: c.id, leadId: l1.id, status: 'sent' });
    const skipped = await createCampaignRecipient({
      campaignId: c.id, leadId: l2.id, status: 'skipped', failureReason: 'cooldown_24h',
    });

    const res = await retryFailedRecipients(c.id);

    expect(res.requeued).toBe(0);
    expect((await recipient(sent.id)).status).toBe('sent');
    expect((await recipient(skipped.id)).status).toBe('skipped');
  });

  it('não reenfileira falha de outra campanha', async () => {
    const a = await campaignWith('completed', 1);
    const b = await campaignWith('completed', 1);
    const rb = await failedRecipient(b.id, 'UazAPI error 400');

    await retryFailedRecipients(a.id);

    expect((await recipient(rb.id)).status).toBe('failed');
  });
});
