import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

import { createApp } from '../app';
import { db } from '../db/client';
import { messages } from '../db/schema';
import { eq } from 'drizzle-orm';
import { createLead, createConversation, createMessage, createWhatsappInstance } from './helpers';

const app = createApp();
const SECRET = 'test-webhook-secret';

beforeEach(async () => {
  process.env.UAZAPI_WEBHOOK_SECRET = SECRET;
  await createWhatsappInstance({ isDefault: true });
});

async function outbound(providerMsgId: string) {
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

function postUpdate(body: unknown) {
  return request(app)
    .post('/api/whatsapp/webhook')
    .set('X-Webhook-Token', SECRET)
    .send(body as object);
}

describe('ACK de entrega da UazAPI (messages_update)', () => {
  it('marca delivered quando a UazAPI reporta DeliveryAck', async () => {
    const msg = await outbound('ACK-1');

    const res = await postUpdate({
      event: 'messages_update',
      message: { id: 'ACK-1', status: 'DeliveryAck' },
    });

    expect(res.status).toBe(200);
    expect((await readBack(msg.id)).deliveryStatus).toBe('delivered');
  });

  it('marca read quando a UazAPI reporta Read', async () => {
    const msg = await outbound('ACK-2');

    await postUpdate({ event: 'messages_update', message: { id: 'ACK-2', status: 'Read' } });

    expect((await readBack(msg.id)).deliveryStatus).toBe('read');
  });

  it('marca sent quando a UazAPI reporta ServerAck', async () => {
    const msg = await outbound('ACK-3');

    await postUpdate({ event: 'messages_update', message: { id: 'ACK-3', status: 'ServerAck' } });

    expect((await readBack(msg.id)).deliveryStatus).toBe('sent');
  });

  it('marca failed e guarda a razão quando a UazAPI reporta Error', async () => {
    const msg = await outbound('ACK-4');

    await postUpdate({
      event: 'messages_update',
      message: { id: 'ACK-4', status: 'Error', error: 'recipient not on whatsapp' },
    });

    const row = await readBack(msg.id);
    expect(row.deliveryStatus).toBe('failed');
    expect(row.deliveryErrorMessage).toBe('recipient not on whatsapp');
  });

  it('continua marcando deleted_at quando o status é Deleted', async () => {
    const msg = await outbound('ACK-5');

    await postUpdate({ event: 'messages_update', message: { id: 'ACK-5', status: 'Deleted' } });

    expect((await readBack(msg.id)).deletedAt).not.toBeNull();
  });

  it('ignora Pending sem sobrescrever um ACK melhor já recebido', async () => {
    const msg = await outbound('ACK-6');
    await postUpdate({ event: 'messages_update', message: { id: 'ACK-6', status: 'Read' } });

    await postUpdate({ event: 'messages_update', message: { id: 'ACK-6', status: 'Pending' } });

    expect((await readBack(msg.id)).deliveryStatus).toBe('read');
  });

  it('responde 200 para ACK de mensagem que não existe localmente', async () => {
    const res = await postUpdate({
      event: 'messages_update',
      message: { id: 'NAO-EXISTE', status: 'Read' },
    });

    expect(res.status).toBe(200);
  });
});
