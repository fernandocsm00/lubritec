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

  // Nenhum ACK da UazAPI chegou em produção até 25/09/2026 (o webhook não
  // assinava messages_update e filtrava wasSentByApi), então o formato real
  // nunca foi visto. Os casos abaixo cobrem as famílias plausíveis: o objeto
  // normalizado da própria UazAPI, o recibo do whatsmeow (Go, base da uazapiGO)
  // e o evento nativo do Baileys. O que não casar vira ignored_update com o
  // corpo cru no painel de debug.
  it('lê o formato com EventType (convenção real dos eventos da UazAPI)', async () => {
    const msg = await outbound('5554921084500:ACK-7');

    await postUpdate({
      EventType: 'messages_update',
      message: { id: '5554921084500:ACK-7', status: 'DeliveryAck', fromMe: true, wasSentByApi: true },
    });

    expect((await readBack(msg.id)).deliveryStatus).toBe('delivered');
  });

  it('lê recibo no formato whatsmeow, com `event` objeto e vários ids', async () => {
    // `event` aqui é o objeto do recibo, não o nome do evento — o nome vem em
    // EventType. Antes, String(event) virava "[object Object]" e o recibo se
    // perdia como "não é mensagem".
    const a = await outbound('ACK-8');
    const b = await outbound('ACK-9');

    const res = await postUpdate({
      EventType: 'messages_update',
      event: { MessageIDs: ['ACK-8', 'ACK-9'], Type: 'read', IsFromMe: true },
      state: 'Read',
    });

    expect(res.status).toBe(200);
    expect((await readBack(a.id)).deliveryStatus).toBe('read');
    expect((await readBack(b.id)).deliveryStatus).toBe('read');
  });

  it('lê o evento nativo do Baileys (lista com status numérico)', async () => {
    const msg = await outbound('ACK-10');

    await postUpdate({
      event: 'messages.update',
      data: [{ key: { id: 'ACK-10', fromMe: true }, update: { status: 3 } }],
    });

    expect((await readBack(msg.id)).deliveryStatus).toBe('delivered');
  });

  it('aproveita o status do eco da própria mensagem enviada', async () => {
    const msg = await outbound('ACK-11');

    const res = await postUpdate({
      EventType: 'messages',
      message: {
        id: 'ACK-11', fromMe: true, wasSentByApi: true, status: 'ServerAck',
        chatid: '5554999990000@s.whatsapp.net', text: 'orçamento', messageTimestamp: 1779909500000,
      },
    });

    expect(res.status).toBe(200);
    expect((await readBack(msg.id)).deliveryStatus).toBe('sent');
    // Eco não vira mensagem recebida.
    const rows = await db.select().from(messages).where(eq(messages.providerMsgId, 'ACK-11'));
    expect(rows).toHaveLength(1);
    expect(rows[0].direction).toBe('out');
  });

  it('responde 200 para ACK de mensagem que não existe localmente', async () => {
    const res = await postUpdate({
      event: 'messages_update',
      message: { id: 'NAO-EXISTE', status: 'Read' },
    });

    expect(res.status).toBe(200);
  });
});
