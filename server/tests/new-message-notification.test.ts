import { describe, it, expect } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/client';
import { notifications } from '../db/schema';
import { ingestInboundMessage } from '../services/whatsappWebhookService';
import { createUser, createLead, createConversation, createWhatsappInstance } from './helpers';

let msgSeq = 0;
function inbound(instanceId: string, phone: string, over: Partial<Parameters<typeof ingestInboundMessage>[0]> = {}) {
  return ingestInboundMessage({
    instanceId,
    provider: 'meta_cloud',
    leadPhone: phone,
    kind: 'text',
    text: 'oi, tudo bem?',
    providerMsgId: `msg-${++msgSeq}-${Math.random().toString(36).slice(2)}`,
    sentAt: new Date(),
    rawPayload: {},
    ...over,
  });
}

async function newMsgNotifs(userId: string) {
  return db.select().from(notifications).where(and(
    eq(notifications.userId, userId),
    eq(notifications.kind, 'new_message'),
  ));
}

describe('notificação de nova mensagem no WhatsApp', () => {
  it('emite para o dono quando a conversa passa a ter não-lida', async () => {
    const inst = await createWhatsappInstance();
    const owner = await createUser({ email: 'nmn-owner@x.com', role: 'recepcao' });
    const lead = await createLead({ phone: '5511990000001' });
    await createConversation({
      phone: '5511990000001', leadId: lead.id, instanceId: inst.id,
      queue: 'recepcao', assignedTo: owner.id, unreadCount: 0,
    });

    await inbound(inst.id, '5511990000001');
    expect(await newMsgNotifs(owner.id)).toHaveLength(1);

    // Segunda mensagem: conversa já está não-lida → não notifica de novo.
    await inbound(inst.id, '5511990000001');
    expect(await newMsgNotifs(owner.id)).toHaveLength(1);
  });

  it('broadcast por role quando a conversa está sem dono (fila recepção)', async () => {
    const inst = await createWhatsappInstance();
    const recep = await createUser({ email: 'nmn-recep@x.com', role: 'recepcao' });
    const lead = await createLead({ phone: '5511990000002' });
    await createConversation({
      phone: '5511990000002', leadId: lead.id, instanceId: inst.id,
      queue: 'recepcao', assignedTo: null, unreadCount: 0,
    });

    await inbound(inst.id, '5511990000002');
    expect((await newMsgNotifs(recep.id)).length).toBeGreaterThanOrEqual(1);
  });

  it('não notifica na fila IA (a IA responde sozinha)', async () => {
    const inst = await createWhatsappInstance();
    const recep = await createUser({ email: 'nmn-ia@x.com', role: 'recepcao' });
    const lead = await createLead({ phone: '5511990000003' });
    await createConversation({
      phone: '5511990000003', leadId: lead.id, instanceId: inst.id,
      queue: 'ia', assignedTo: null, unreadCount: 0,
    });

    await inbound(inst.id, '5511990000003');
    expect(await newMsgNotifs(recep.id)).toHaveLength(0);
  });
});
