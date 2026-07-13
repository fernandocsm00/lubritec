import { describe, it, expect } from 'vitest';
import { createLead } from './helpers';
import { dryRun, resolveAudience, materializeCsvLeads } from '../services/campaignsAudience';

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

  it('phoneCsv define a audiência = telefones do CSV (leads existentes casam)', async () => {
    await createLead({ phone: '5511987650001', status: 'frio' });
    await createLead({ phone: '5511987650002', status: 'quente' });
    await createLead({ phone: '5511987650003', status: 'morno' });

    const r = await dryRun({
      phoneCsv: ['5511987650001', '5511987650002'],
    });
    expect(r.total).toBe(2);
    expect(r.newFromCsv).toBe(0);
  });

  it('phoneCsv conta telefones NOVOS (que ainda não são leads) sem criar nada', async () => {
    await createLead({ phone: '5511987650010', status: 'frio' });

    // 1 já é lead + 2 novos = total 3, sendo 2 a criar.
    const r = await dryRun({
      phoneCsv: ['5511987650010', '5511987650011', '5511987650012'],
    });
    expect(r.total).toBe(3);
    expect(r.newFromCsv).toBe(2);
    expect(r.eligible).toBe(3); // novos são sempre elegíveis
    // Preview marca os novos com isNew.
    const novos = r.preview.filter((p) => p.isNew);
    expect(novos).toHaveLength(2);
    // dryRun é read-only: nada foi criado na base.
    const check = await dryRun({});
    expect(check.total).toBe(1);
  });

  it('phoneCsv IGNORA filtros de status/origem (dispara pra lista toda)', async () => {
    await createLead({ phone: '5511987650020', status: 'quente', source: 'whatsapp' });

    // Mesmo filtrando status=frio, o lead quente do CSV entra.
    const r = await dryRun({
      status: ['frio'],
      phoneCsv: ['5511987650020'],
    });
    expect(r.total).toBe(1);
  });

  it('phoneCsv normaliza os DOIS lados (lead legado sem o 9/55 casa com CSV)', async () => {
    // Lead legado gravado SEM o 9 e SEM o 55 (formato antigo na base).
    await createLead({ phone: '5496532189', status: 'frio' });

    // Planilha traz o mesmo número em outro formato (com 55, sem 9).
    const r = await dryRun({ phoneCsv: ['555496532189'] });
    expect(r.total).toBe(1);
    expect(r.newFromCsv).toBe(0); // casou com o legado, não cria duplicado
  });

  it('excludeLeadIds ignora ids sintéticos (new:...) sem quebrar a query', async () => {
    await createLead({ phone: '5511987650030', status: 'frio' });
    // Simula o frontend mandando um id sintético de lead novo junto.
    const r = await dryRun({
      phoneCsv: ['5511987650030', '5511987650031'],
      excludeLeadIds: ['new:5511987650031'],
    });
    // Não estoura, e o id sintético é ignorado (não filtra nada de verdade).
    expect(r.total).toBe(2);
    expect(r.newFromCsv).toBe(1);
  });

  it('phoneCsv com telefones todos inválidos resulta em audiência vazia', async () => {
    await createLead({ phone: '5511000051001', status: 'frio' });
    const r = await dryRun({ phoneCsv: ['123', '000'] });
    expect(r.total).toBe(0);
    expect(r.newFromCsv).toBe(0);
  });

  it('preview paginado por pageSize (default 50, configurável)', async () => {
    for (let i = 1; i <= 7; i++) {
      await createLead({ phone: `5511000060${String(i).padStart(3, '0')}`, status: 'frio' });
    }
    // Default pageSize=50 -> tudo cabe em uma pagina
    const r1 = await dryRun({ status: ['frio'] });
    expect(r1.total).toBe(7);
    expect(r1.preview).toHaveLength(7);
    expect(r1.page).toBe(1);
    expect(r1.pageCount).toBe(1);

    // pageSize=5 -> 2 paginas (5 + 2)
    const r2a = await dryRun({ status: ['frio'] }, { page: 1, pageSize: 5 });
    expect(r2a.preview).toHaveLength(5);
    expect(r2a.pageCount).toBe(2);
    expect(r2a.page).toBe(1);

    const r2b = await dryRun({ status: ['frio'] }, { page: 2, pageSize: 5 });
    expect(r2b.preview).toHaveLength(2);
    expect(r2b.pageCount).toBe(2);
    expect(r2b.page).toBe(2);
  });

  it('eligibleIds retorna lista completa de elegíveis (não só da página)', async () => {
    for (let i = 1; i <= 4; i++) {
      await createLead({ phone: `5511000061${String(i).padStart(3, '0')}`, status: 'frio' });
    }
    const r = await dryRun({ status: ['frio'] }, { page: 1, pageSize: 2 });
    expect(r.preview).toHaveLength(2);
    expect(r.pageCount).toBe(2);
    expect(r.eligibleIds).toHaveLength(4); // todos elegíveis, não só os 2 da página
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

describe('campaignsAudience.materializeCsvLeads', () => {
  it('cria leads pros telefones novos e deixa a audiência disparável', async () => {
    await createLead({ phone: '5511987651001', status: 'frio' });

    const filter = {
      phoneCsv: ['5511987651001', '5511987651002', '5511987651003'],
    };

    const created = await materializeCsvLeads(filter);
    expect(created).toBe(2); // 2 novos (o 651001 já existia)

    // Agora resolveAudience retorna os 3 (existente + 2 criados).
    const audience = await resolveAudience(filter);
    expect(audience).toHaveLength(3);

    // Idempotente: rodar de novo não cria duplicados.
    const again = await materializeCsvLeads(filter);
    expect(again).toBe(0);
  });

  it('não cria nada quando não há CSV', async () => {
    const created = await materializeCsvLeads({ status: ['frio'] });
    expect(created).toBe(0);
  });

  it('não cria lead para telefone inválido', async () => {
    const created = await materializeCsvLeads({ phoneCsv: ['123', 'abc'] });
    expect(created).toBe(0);
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
