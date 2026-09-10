import { describe, it, expect } from 'vitest';
import {
  createUser, createLead, createCampaign, createCampaignRecipient,
  createConversation, createMessage,
} from './helpers';
import { getCampaignFunnel } from '../services/campaignsService';
import type { DeliveryStatus } from '@shared/types';

/**
 * "Enviadas" na campanha sempre significou "o provedor aceitou na fila" — nunca
 * "chegou". O funil precisa separar o disparado do confirmado, senão a taxa de
 * resposta é calculada sobre um denominador que inclui mensagens que ninguém
 * recebeu.
 */
async function dispatched(campaignId: string, delivery: DeliveryStatus | null) {
  const lead = await createLead({});
  const conv = await createConversation({ leadId: lead.id });
  const msg = await createMessage({
    conversationId: conv.id,
    direction: 'out',
    deliveryStatus: delivery,
  });
  return createCampaignRecipient({
    campaignId,
    leadId: lead.id,
    status: 'sent',
    sentAt: new Date(),
    conversationId: conv.id,
    messageId: msg.id,
  });
}

async function newCampaign(email: string) {
  const u = await createUser({ email, role: 'admin' });
  return createCampaign({ createdByUserId: u.id });
}

describe('getCampaignFunnel — entrega confirmada', () => {
  it('conta como entregue só o que teve ACK de delivered ou read', async () => {
    const c = await newCampaign('fd1@x.com');
    await dispatched(c.id, 'delivered');
    await dispatched(c.id, 'read');
    await dispatched(c.id, 'queued');

    const f = await getCampaignFunnel(c.id);
    expect(f.sent).toBe(3);
    expect(f.delivered).toBe(2);
  });

  it('conta lidas separadamente', async () => {
    const c = await newCampaign('fd2@x.com');
    await dispatched(c.id, 'read');
    await dispatched(c.id, 'delivered');

    const f = await getCampaignFunnel(c.id);
    expect(f.read).toBe(1);
  });

  it('conta como sem confirmação o que ficou preso na fila do provedor', async () => {
    const c = await newCampaign('fd3@x.com');
    await dispatched(c.id, 'queued');
    await dispatched(c.id, 'sent');
    await dispatched(c.id, 'delivered');

    const f = await getCampaignFunnel(c.id);
    expect(f.awaitingAck).toBe(2);
  });

  it('trata disparo anterior à instrumentação como sem confirmação, não como entregue', async () => {
    const c = await newCampaign('fd4@x.com');
    await dispatched(c.id, null);

    const f = await getCampaignFunnel(c.id);
    expect(f.delivered).toBe(0);
    expect(f.awaitingAck).toBe(1);
  });

  it('zera as contagens de entrega quando não houve disparo', async () => {
    const c = await newCampaign('fd5@x.com');

    const f = await getCampaignFunnel(c.id);
    expect(f.delivered).toBe(0);
    expect(f.read).toBe(0);
    expect(f.awaitingAck).toBe(0);
  });
});
