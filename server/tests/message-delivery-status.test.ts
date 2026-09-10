import { describe, it, expect } from 'vitest';
import { db } from '../db/client';
import { messages } from '../db/schema';
import { eq } from 'drizzle-orm';
import { createLead, createConversation, createMessage } from './helpers';
import { recordDeliveryStatus } from '../services/messageDelivery';

async function outboundMessage(providerMsgId: string) {
  const lead = await createLead({});
  const conv = await createConversation({ leadId: lead.id });
  return createMessage({
    conversationId: conv.id,
    direction: 'out',
    providerMsgId,
    provider: 'uazapi',
  });
}

async function readBack(id: string) {
  const [row] = await db.select().from(messages).where(eq(messages.id, id));
  return row;
}

describe('recordDeliveryStatus', () => {
  it('grava o status de entrega na mensagem correspondente', async () => {
    const msg = await outboundMessage('ABC123');

    const res = await recordDeliveryStatus({
      provider: 'uazapi',
      providerMsgId: 'ABC123',
      status: 'delivered',
    });

    expect(res.updated).toBe(true);
    const row = await readBack(msg.id);
    expect(row.deliveryStatus).toBe('delivered');
    expect(row.deliveryStatusAt).not.toBeNull();
  });

  it('não regride para um status anterior ao já registrado', async () => {
    const msg = await outboundMessage('ABC124');
    await recordDeliveryStatus({ provider: 'uazapi', providerMsgId: 'ABC124', status: 'read' });

    const res = await recordDeliveryStatus({
      provider: 'uazapi',
      providerMsgId: 'ABC124',
      status: 'sent',
    });

    expect(res.updated).toBe(false);
    expect((await readBack(msg.id)).deliveryStatus).toBe('read');
  });

  it('guarda o código e a razão do erro quando o provedor reporta falha', async () => {
    const msg = await outboundMessage('ABC125');

    await recordDeliveryStatus({
      provider: 'uazapi',
      providerMsgId: 'ABC125',
      status: 'failed',
      errorCode: '131026',
      errorMessage: 'Message undeliverable',
    });

    const row = await readBack(msg.id);
    expect(row.deliveryStatus).toBe('failed');
    expect(row.deliveryErrorCode).toBe('131026');
    expect(row.deliveryErrorMessage).toBe('Message undeliverable');
  });

  it('não sobrescreve entrega confirmada com uma falha atrasada', async () => {
    const msg = await outboundMessage('ABC126');
    await recordDeliveryStatus({ provider: 'uazapi', providerMsgId: 'ABC126', status: 'delivered' });

    const res = await recordDeliveryStatus({
      provider: 'uazapi',
      providerMsgId: 'ABC126',
      status: 'failed',
      errorCode: '999',
    });

    expect(res.updated).toBe(false);
    expect((await readBack(msg.id)).deliveryStatus).toBe('delivered');
  });

  it('casa provider_msg_id gravado como owner:messageid com o id puro do webhook', async () => {
    const msg = await outboundMessage('555421084500:ABC127');

    const res = await recordDeliveryStatus({
      provider: 'uazapi',
      providerMsgId: 'ABC127',
      status: 'sent',
    });

    expect(res.updated).toBe(true);
    expect((await readBack(msg.id)).deliveryStatus).toBe('sent');
  });

  it('reporta quando não existe mensagem local com aquele id', async () => {
    const res = await recordDeliveryStatus({
      provider: 'uazapi',
      providerMsgId: 'NAO-EXISTE',
      status: 'delivered',
    });

    expect(res.updated).toBe(false);
    expect(res.reason).toContain('no local message');
  });
});
