import { describe, it, expect } from 'vitest';
import { createLead } from './helpers';
import { dryRun, resolveAudience } from '../services/campaignsAudience';

describe('campaignsAudience.dryRun', () => {
  it('total e preview vazios sem leads', async () => {
    const r = await dryRun({});
    expect(r.total).toBe(0);
    expect(r.preview).toHaveLength(0);
  });

  it('filtra por status', async () => {
    await createLead({ phone: '5511000010001', status: 'frio' });
    await createLead({ phone: '5511000010002', status: 'morno' });
    await createLead({ phone: '5511000010003', status: 'quente' });

    const r = await dryRun({ status: ['frio', 'morno'] });
    expect(r.total).toBe(2);
  });

  it('filtra por source', async () => {
    await createLead({ phone: '5511000020001', source: 'manual' });
    await createLead({ phone: '5511000020002', source: 'csv' });
    await createLead({ phone: '5511000020003', source: 'whatsapp' });

    const r = await dryRun({ source: ['csv', 'whatsapp'] });
    expect(r.total).toBe(2);
  });

  it('filtra por daysSinceCreated (cadastro antigo)', async () => {
    const today = new Date();
    const oldDate = new Date(today.getTime() - 100 * 24 * 60 * 60 * 1000);
    const recentDate = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

    await createLead({ phone: '5511000030001', createdAt: oldDate });
    await createLead({ phone: '5511000030002', createdAt: oldDate });
    await createLead({ phone: '5511000030003', createdAt: recentDate });

    const r = await dryRun({ daysSinceCreated: 60 });
    expect(r.total).toBe(2);
  });

  it('excludeLeadIds remove leads', async () => {
    const a = await createLead({ phone: '5511000040001', status: 'frio' });
    const b = await createLead({ phone: '5511000040002', status: 'frio' });

    const r = await dryRun({ status: ['frio'], excludeLeadIds: [a.id] });
    expect(r.total).toBe(1);
    expect(r.preview[0].leadId).toBe(b.id);
  });

  it('phoneCsv inclui leads pelos telefones (OR com filtros)', async () => {
    await createLead({ phone: '5511000050001', status: 'frio' });
    await createLead({ phone: '5511000050002', status: 'quente' });
    const c = await createLead({ phone: '5511000050003', status: 'morno' });

    const r = await dryRun({
      status: ['frio'],
      phoneCsv: ['5511000050003'],
    });
    expect(r.total).toBe(2);
  });

  it('preview limita a 5 leads', async () => {
    for (let i = 1; i <= 7; i++) {
      await createLead({ phone: `5511000060${String(i).padStart(3, '0')}`, status: 'frio' });
    }
    const r = await dryRun({ status: ['frio'] });
    expect(r.total).toBe(7);
    expect(r.preview).toHaveLength(5);
  });

  it('retorna eligible e blocked com cooldown', async () => {
    const { createUser, createConversation, createMessage } = await import('./helpers');
    const u = await createUser({ role: 'comercial', email: 'dr1@x.com' });
    const eligibleLead = await createLead({ phone: '5511900050001', status: 'frio' });
    const blockedLead = await createLead({ phone: '5511900050002', status: 'frio' });
    const conv = await createConversation({ leadId: blockedLead.id });
    await createMessage({
      conversationId: conv.id,
      direction: 'out',
      sentByUserId: u.id,
      sentAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });

    const r = await dryRun({ status: ['frio'] });
    expect(r.total).toBe(2);
    expect(r.eligible).toBe(1);
    expect(r.blocked.recentOutbound).toBe(1);
    expect(r.blocked.pendingOtherCampaign).toBe(0);
    // Comportamento novo (2026-05-22): preview inclui BLOQUEADOS junto com
    // elegiveis, com blockReason setado. Usuario precisa ver quem nao vai
    // receber antes de confirmar.
    const blockedEntry = r.preview.find((p) => p.leadId === blockedLead.id);
    expect(blockedEntry).toBeDefined();
    expect(blockedEntry?.blockReason).toBe('recent_outbound');
    const eligibleEntry = r.preview.find((p) => p.leadId === eligibleLead.id);
    expect(eligibleEntry).toBeDefined();
    expect(eligibleEntry?.blockReason).toBeNull();
  });
});

describe('campaignsAudience.resolveAudience', () => {
  it('retorna lista completa de {leadId, phone}', async () => {
    const a = await createLead({ phone: '5511000070001', status: 'frio' });
    const b = await createLead({ phone: '5511000070002', status: 'frio' });
    await createLead({ phone: '5511000070003', status: 'quente' });

    const r = await resolveAudience({ status: ['frio'] });
    expect(r).toHaveLength(2);
    const ids = r.map((x) => x.leadId);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
  });
});
