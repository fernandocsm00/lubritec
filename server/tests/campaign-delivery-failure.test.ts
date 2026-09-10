import { describe, it, expect } from 'vitest';
import { db } from '../db/client';
import { campaignRecipients, campaigns } from '../db/schema';
import { eq } from 'drizzle-orm';
import {
  createUser, createLead, createConversation, createMessage,
  createCampaign, createCampaignRecipient,
} from './helpers';
import { recordDeliveryStatus } from '../services/messageDelivery';

/**
 * Cenário: o disparo saiu, o provedor devolveu 200 e o destinatário virou
 * 'sent'. Minutos depois o ACK diz que a mensagem NÃO foi entregue. Antes da
 * instrumentação esse ACK era descartado e o destinatário ficava 'sent' pra
 * sempre — inflando o funil com mensagens que nunca chegaram.
 */
async function dispatchedRecipient(providerMsgId: string, sentCount = 1) {
  const user = await createUser({ email: `c${Date.now()}${Math.random()}@x.com`, role: 'admin' });
  const lead = await createLead({});
  const conv = await createConversation({ leadId: lead.id });
  const msg = await createMessage({
    conversationId: conv.id,
    direction: 'out',
    providerMsgId,
    provider: 'uazapi',
  });
  const camp = await createCampaign({ createdByUserId: user.id, sentCount, failedCount: 0 });
  const rec = await createCampaignRecipient({
    campaignId: camp.id,
    leadId: lead.id,
    status: 'sent',
    sentAt: new Date(),
    conversationId: conv.id,
    messageId: msg.id,
  });
  return { camp, rec, msg };
}

const recipient = async (id: string) =>
  (await db.select().from(campaignRecipients).where(eq(campaignRecipients.id, id)))[0];
const campaign = async (id: string) =>
  (await db.select().from(campaigns).where(eq(campaigns.id, id)))[0];

describe('ACK de falha em mensagem de disparo', () => {
  it('marca o destinatário como failed com a razão do provedor', async () => {
    const { rec } = await dispatchedRecipient('CAMP-1');

    await recordDeliveryStatus({
      provider: 'uazapi',
      providerMsgId: 'CAMP-1',
      status: 'failed',
      errorCode: '131026',
      errorMessage: 'Message undeliverable',
    });

    const r = await recipient(rec.id);
    expect(r.status).toBe('failed');
    expect(r.failureReason).toContain('131026');
    expect(r.failureReason).toContain('undeliverable');
  });

  it('corrige os contadores da campanha (tira de enviadas, põe em falhas)', async () => {
    const { camp, rec } = await dispatchedRecipient('CAMP-2', 5);

    await recordDeliveryStatus({
      provider: 'uazapi',
      providerMsgId: 'CAMP-2',
      status: 'failed',
      errorCode: '131026',
    });

    const c = await campaign(camp.id);
    expect(c.sentCount).toBe(4);
    expect(c.failedCount).toBe(1);
    expect((await recipient(rec.id)).status).toBe('failed');
  });

  it('não conta duas vezes quando o ACK de falha é reentregue', async () => {
    const { camp } = await dispatchedRecipient('CAMP-3', 5);
    const ack = {
      provider: 'uazapi' as const,
      providerMsgId: 'CAMP-3',
      status: 'failed' as const,
      errorCode: '131026',
    };

    await recordDeliveryStatus(ack);
    await recordDeliveryStatus(ack);

    const c = await campaign(camp.id);
    expect(c.sentCount).toBe(4);
    expect(c.failedCount).toBe(1);
  });

  it('não mexe no destinatário quando o ACK confirma entrega', async () => {
    const { camp, rec } = await dispatchedRecipient('CAMP-4', 5);

    await recordDeliveryStatus({
      provider: 'uazapi',
      providerMsgId: 'CAMP-4',
      status: 'delivered',
    });

    expect((await recipient(rec.id)).status).toBe('sent');
    expect((await campaign(camp.id)).sentCount).toBe(5);
  });

  it('aceita ACK de falha em mensagem que não é disparo sem quebrar', async () => {
    const lead = await createLead({});
    const conv = await createConversation({ leadId: lead.id });
    const msg = await createMessage({
      conversationId: conv.id, direction: 'out', providerMsgId: 'CAMP-5', provider: 'uazapi',
    });

    const res = await recordDeliveryStatus({
      provider: 'uazapi', providerMsgId: 'CAMP-5', status: 'failed', errorCode: '131026',
    });

    expect(res.updated).toBe(true);
    expect(res.messageId).toBe(msg.id);
  });
});
