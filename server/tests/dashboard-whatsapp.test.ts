import { describe, it, expect } from 'vitest';
import { whatsappStats } from '../services/dashboardService';
import { createLead, createConversation, createMessage, createWhatsappInstance } from './helpers';

describe('dashboardService.whatsappStats', () => {
  it('inQueue conta conversas abertas visíveis na Inbox (exclui disparo de campanha sem inbound e encerradas)', async () => {
    const [l1, l2, l3, l4, l5] = await Promise.all([
      createLead({}), createLead({}), createLead({}), createLead({}), createLead({}),
    ]);
    // Conta: organic aguardando (visível mesmo sem inbound)
    await createConversation({ leadId: l1.id, status: 'aguardando_atendimento', originKind: 'organic' });
    // Conta: organic em_atendimento (não-encerrada)
    await createConversation({ leadId: l2.id, status: 'em_atendimento', originKind: 'organic' });
    // NÃO conta: disparo de campanha nunca respondido (sem inbound) — o "581" irreal
    await createConversation({ leadId: l3.id, status: 'aguardando_atendimento', originKind: 'campaign', lastInboundAt: null });
    // Conta: campanha QUE respondeu (tem inbound)
    await createConversation({ leadId: l4.id, status: 'aguardando_atendimento', originKind: 'campaign', lastInboundAt: new Date() });
    // NÃO conta: encerrada
    await createConversation({ leadId: l5.id, status: 'encerrada', originKind: 'organic' });

    const r = await whatsappStats();
    expect(r.inQueue).toBe(3);
  });

  it('awaitingUs matches attention.pending_reply logic (no outbound after inbound)', async () => {
    const l = await createLead({});
    await createConversation({
      leadId: l.id,
      queue: 'comercial', // awaitingUsSql exige fila comercial (ou aiDisabled)
      status: 'em_atendimento',
      lastInboundAt: new Date(Date.now() - 2 * 86_400_000),
      lastMessageAt: new Date(Date.now() - 2 * 86_400_000),
    });
    const r = await whatsappStats();
    expect(r.awaitingUs).toBe(1);
  });

  it('avgFirstResponseSec averages first-out minus first-in over last 7d', async () => {
    const lead = await createLead({});
    const conv = await createConversation({ leadId: lead.id, status: 'em_atendimento' });
    const inAt = new Date(Date.now() - 60_000);  // 1 min ago
    const outAt = new Date(Date.now() - 30_000); // 30s ago
    await createMessage({ conversationId: conv.id, direction: 'in', sentAt: inAt });
    await createMessage({ conversationId: conv.id, direction: 'out', sentAt: outAt, sentByUserId: null });

    const r = await whatsappStats();
    expect(r.avgFirstResponseSec).toBeGreaterThanOrEqual(29);
    expect(r.avgFirstResponseSec).toBeLessThanOrEqual(31);
  });

  it('noResponseToday counts conversations with inbound today and no outbound after', async () => {
    const lead = await createLead({});
    const conv = await createConversation({
      leadId: lead.id,
      status: 'aguardando_atendimento',
      lastInboundAt: new Date(),
      lastMessageAt: new Date(),
    });
    await createMessage({ conversationId: conv.id, direction: 'in', sentAt: new Date() });
    const r = await whatsappStats();
    expect(r.noResponseToday).toBeGreaterThanOrEqual(1);
  });

  it('instanceConnected reflects whatsapp_instance.last_status', async () => {
    // No instance row → disconnected
    let r = await whatsappStats();
    expect(r.instanceConnected).toBe(false);

    // Create connected default instance (dashboardService queries by is_default=true)
    await createWhatsappInstance({ lastStatus: 'connected', isDefault: true });
    r = await whatsappStats();
    expect(r.instanceConnected).toBe(true);
  });
});
