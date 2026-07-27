import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLead, updateLead, deleteLead, listLeads, closeLeadNoDeal } from '../services/leadsService';
import { parseLeadsCsv, importLeadsFromCsv } from '../services/leadsImport';
import { createLead as seedLead } from './helpers';
import * as cnpjLookup from '../services/cnpjLookup';
import { db } from '../db/client';

// Real CNPJs (just digits — the validator computes verification digits, so
// these are mathematically valid and unique across tests).
const VALID_CNPJ_1 = '11444777000161'; // Banco do Brasil
const VALID_CNPJ_2 = '00360305000104'; // Caixa
const VALID_CNPJ_3 = '33000167000101'; // Petrobras
const VALID_CNPJ_4 = '60746948000112'; // Bradesco
const VALID_CNPJ_5 = '60872504000123'; // Itaú

describe('createLead', () => {
  it('cria lead com defaults frio/manual', async () => {
    const lead = await createLead({ name: 'Empresa A', phone: '11999998888', cnpj: VALID_CNPJ_1 });
    expect(lead.status).toBe('frio');
    expect(lead.source).toBe('manual');
    expect(lead.phone).toBe('5511999998888'); // canonico E.164 BR com 55+9
    expect(lead.cnpj).toBe(VALID_CNPJ_1);
    expect(lead.id).toBeDefined();
  });

  it('normaliza phone e cnpj (remove não-dígitos)', async () => {
    const lead = await createLead({
      name: 'Empresa B',
      phone: '(11) 99999-7777',
      cnpj: '00.360.305/0001-04',
    });
    expect(lead.phone).toBe('5511999997777'); // canonico E.164 BR com 55+9
    expect(lead.cnpj).toBe(VALID_CNPJ_2);
  });

  it('rejeita CNPJ inválido', async () => {
    await expect(
      createLead({ name: 'X', phone: '11999996666', cnpj: '11111111111111' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('aceita CPF valido no campo cnpj (lead pessoa fisica)', async () => {
    const lead = await createLead({
      name: 'Joao da Silva',
      phone: '11999990500',
      cnpj: '529.982.247-25', // CPF valido
    });
    expect(lead.cnpj).toBe('52998224725');
  });

  it('rejeita CPF com digito verificador errado', async () => {
    await expect(
      createLead({ name: 'X', phone: '11999990501', cnpj: '11111111111' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejeita CNPJ duplicado com 409', async () => {
    await createLead({ name: 'A', phone: '11999996001', cnpj: VALID_CNPJ_3 });
    await expect(
      createLead({ name: 'B', phone: '11999996002', cnpj: VALID_CNPJ_3 }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('persiste UF (RS/BA) no cadastro', async () => {
    const lead = await createLead({
      name: 'Empresa UF',
      phone: '11999997010',
      cnpj: VALID_CNPJ_4,
      uf: 'BA',
    });
    expect(lead.uf).toBe('BA');
  });

  it('UF ausente fica null', async () => {
    const lead = await createLead({ name: 'Sem UF', phone: '11999997011', cnpj: VALID_CNPJ_5 });
    expect(lead.uf).toBeNull();
  });
});

describe('updateLead', () => {
  it('atualiza UF', async () => {
    const seed = await seedLead({ name: 'UF edit', phone: '11999997020' });
    const updated = await updateLead({ id: seed.id, uf: 'RS' });
    expect(updated.uf).toBe('RS');
  });

  it('atualiza nome e status', async () => {
    const seed = await seedLead({ name: 'Old', phone: '11999990000' });
    const updated = await updateLead({ id: seed.id, name: 'New', status: 'morno' });
    expect(updated.name).toBe('New');
    expect(updated.status).toBe('morno');
  });

  it('partial update preserva campos não enviados', async () => {
    const seed = await seedLead({ name: 'Mario', phone: '11999991111', email: 'm@x.com' });
    const updated = await updateLead({ id: seed.id, notes: 'novo' });
    expect(updated.name).toBe('Mario');
    expect(updated.email).toBe('m@x.com');
    expect(updated.notes).toBe('novo');
  });

  it('404 quando id não existe', async () => {
    await expect(
      updateLead({ id: '00000000-0000-0000-0000-000000000000', name: 'X' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('null limpa campo opcional', async () => {
    const seed = await seedLead({ name: 'Nina', phone: '11999993333', email: 'nina@x.com' });
    const updated = await updateLead({ id: seed.id, email: null });
    expect(updated.email).toBeNull();
  });
});

describe('deleteLead', () => {
  it('deleta e retorna void', async () => {
    const seed = await seedLead({ phone: '11999992222' });
    await deleteLead(seed.id);
    await expect(deleteLead(seed.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe('listLeads', () => {
  it('busca por name (q)', async () => {
    await seedLead({ name: 'Antonio Silva', phone: '11000000020' });
    await seedLead({ name: 'Beatriz Souza', phone: '11000000021' });
    const res = await listLeads({ q: 'Antonio' });
    expect(res.total).toBe(1);
    expect(res.items[0].name).toBe('Antonio Silva');
  });

  it('busca por cnpj (q)', async () => {
    await seedLead({ name: 'Y', phone: '11000000040', cnpj: VALID_CNPJ_4 });
    const res = await listLeads({ q: VALID_CNPJ_4 });
    expect(res.total).toBe(1);
  });

  it('default sort é created_at desc', async () => {
    const a = await seedLead({ name: 'Old', phone: '11000000060' });
    await new Promise((r) => setTimeout(r, 10));
    const b = await seedLead({ name: 'New', phone: '11000000061' });
    const res = await listLeads({});
    expect(res.items[0].id).toBe(b.id);
    expect(res.items[1].id).toBe(a.id);
  });
});

describe('parseLeadsCsv', () => {
  it('aceita header EN com vírgula', async () => {
    const csv = `name,phone,cnpj,email\nEmpresa A,11999990001,${VALID_CNPJ_1},a@x.com\nEmpresa B,11999990002,${VALID_CNPJ_2},\n`;
    const { rows, rejected, missingHeaders } = await parseLeadsCsv(Buffer.from(csv));
    expect(missingHeaders).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: 'Empresa A', phone: '5511999990001', cnpj: VALID_CNPJ_1, email: 'a@x.com' });
    expect(rows[1].email).toBeNull();
    expect(rejected).toEqual([]);
  });

  it('aceita header PT com ponto-e-vírgula', async () => {
    const csv = `nome;telefone;cnpj\nEmpresa Maria;(11) 99999-0003;${VALID_CNPJ_3}\n`;
    const { rows, rejected } = await parseLeadsCsv(Buffer.from(csv));
    expect(rows[0]).toMatchObject({
      name: 'Empresa Maria',
      phone: '5511999990003',
      cnpj: VALID_CNPJ_3,
    });
    expect(rejected).toEqual([]);
  });

  it('rejeita linha com CNPJ inválido', async () => {
    const csv = `name,phone,cnpj\nA,11999990010,11111111111111\n`;
    const { rejected } = await parseLeadsCsv(Buffer.from(csv));
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatch(/cnpj/i);
  });

  it('reconhece a coluna UF (sigla e por extenso)', async () => {
    const csv = `nome,telefone,cnpj,uf\nEmpresa RS,11999990201,${VALID_CNPJ_1},RS\nEmpresa BA,11999990202,${VALID_CNPJ_2},Bahia\nSem UF,11999990203,${VALID_CNPJ_3},\n`;
    const { rows, rejected } = await parseLeadsCsv(Buffer.from(csv));
    expect(rejected).toEqual([]);
    expect(rows[0].uf).toBe('RS');
    expect(rows[1].uf).toBe('BA');
    expect(rows[2].uf).toBeNull();
  });

  it('rejeita CNPJ duplicado dentro do arquivo', async () => {
    const csv = `name,phone,cnpj\nA,11999990001,${VALID_CNPJ_1}\nB,11999990002,${VALID_CNPJ_1}\n`;
    const { rows, rejected } = await parseLeadsCsv(Buffer.from(csv));
    expect(rows).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatch(/duplicado/i);
  });

  it('reporta missingHeaders quando faltam obrigatórias', async () => {
    // Phone NÃO é mais obrigatório (leads CNPJ-only vão pra enriquecimento).
    // Apenas name + cnpj são exigidos no header.
    const csv = `email\na@x.com\n`;
    const { missingHeaders } = await parseLeadsCsv(Buffer.from(csv));
    expect(missingHeaders).toContain('name');
    expect(missingHeaders).toContain('cnpj');
    expect(missingHeaders).not.toContain('phone');
  });

  it('aceita CSV sem coluna phone — leads viram flowStage=incomplete', async () => {
    const csv = `name,cnpj\nEmpresa Sem Telefone,${VALID_CNPJ_1}\n`;
    const { rows, rejected, missingHeaders } = await parseLeadsCsv(Buffer.from(csv));
    expect(missingHeaders).toEqual([]);
    expect(rejected).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0].phone).toBeNull();
  });

  it('aceita arquivo com BOM UTF-8 (Excel)', async () => {
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const csv = Buffer.concat([
      bom,
      Buffer.from(`name,phone,cnpj\nAlice,11999990060,${VALID_CNPJ_5}\n`),
    ]);
    const { rows, missingHeaders } = await parseLeadsCsv(csv);
    expect(missingHeaders).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Alice');
  });

  it('aceita arquivo XLSX nativamente (converte primeira planilha em CSV)', async () => {
    // Cria um XLSX in-memory com 1 header + 1 linha
    const ExcelJSImpl = (await import('exceljs')).default;
    const wb = new ExcelJSImpl.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow(['nome', 'telefone', 'cnpj']);
    // Importante: forca o CNPJ a ser STRING (nao number) pra preservar leading zeros
    const row = ws.addRow(['Empresa XLSX', '11999991234', VALID_CNPJ_2]);
    row.getCell(3).numFmt = '@'; // text format
    const arrayBuf = await wb.xlsx.writeBuffer();
    const buf = Buffer.from(arrayBuf as ArrayBuffer);

    const { rows, rejected, missingHeaders } = await parseLeadsCsv(buf);
    expect(missingHeaders).toEqual([]);
    expect(rejected).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'Empresa XLSX',
      phone: '5511999991234', // canonico
      cnpj: VALID_CNPJ_2,
    });
  });

  it('rejeita arquivo XLS antigo (BIFF) com mensagem orientando salvar como XLSX/CSV', async () => {
    const fakeXls = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    await expect(parseLeadsCsv(fakeXls)).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/XLS.*pré-2007|XLSX|CSV/i),
    });
  });
});

describe('importLeadsFromCsv', () => {
  beforeEach(() => {
    // Mock BrasilAPI to keep tests offline and fast — every CNPJ comes back
    // active. CNPJ-format/dedupe rejection logic is covered by parseLeadsCsv.
    vi.spyOn(cnpjLookup, 'lookupCnpj').mockImplementation(async (cnpj: string) => ({
      cnpj,
      status: 'active',
      razaoSocial: 'Test Co.',
      situacaoCadastral: 'ATIVA',
      telefone: null,
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('insere linhas novas com source=csv e status=frio', async () => {
    const csv = `name,phone,cnpj\nA,11888880001,${VALID_CNPJ_1}\nB,11888880002,${VALID_CNPJ_2}\n`;
    const report = await importLeadsFromCsv(Buffer.from(csv), { throttleMs: 0 });
    expect(report.inserted).toBe(2);
    expect(report.updated).toBe(0);
    expect(report.rejected).toEqual([]);
    const list = await listLeads({ source: 'csv' });
    expect(list.total).toBe(2);
    expect(list.items[0].status).toBe('frio');
  });

  it('CNPJ baixado: import NAO bloqueia mais (mudanca 2026-05-22)', async () => {
    // Comportamento antigo: import consultava BrasilAPI sincronamente e
    // rejeitava CNPJs inativos na hora. Causava friccao quando BrasilAPI estava
    // fora (403) ou pra CSVs grandes (21s entre calls).
    //
    // Comportamento novo: import valida so o formato e insere. CNPJ inativo
    // eh descoberto pelo enrichmentWorker em background e marcado em
    // enrichment_job_leads.result_status='cnpj_inactive' — leadsService.listLeads
    // expoe via lastEnrichmentResult e o frontend filtra com "Com problemas".
    const csv = `name,phone,cnpj\nA,11888880010,${VALID_CNPJ_3}\n`;
    const report = await importLeadsFromCsv(Buffer.from(csv));
    expect(report.inserted).toBe(1);
    expect(report.rejected).toEqual([]);
    // lookupCnpj nao deve ter sido chamado durante o import — eh background agora.
    expect(vi.mocked(cnpjLookup.lookupCnpj)).not.toHaveBeenCalled();
  });

  it('upsert seletivo por CNPJ: preenche só campos vazios', async () => {
    await seedLead({
      name: 'Empresa Original',
      phone: '11888880020',
      cnpj: VALID_CNPJ_4,
      email: 'orig@x.com',
      notes: null,
      source: 'manual',
    });
    const csv = `name,phone,cnpj,email,notes\nEmpresa CSV,11888880099,${VALID_CNPJ_4},csv@x.com,nota nova\n`;
    const report = await importLeadsFromCsv(Buffer.from(csv));
    expect(report.inserted).toBe(0);
    expect(report.updated).toBe(1);
    const list = await listLeads({ q: VALID_CNPJ_4 });
    expect(list.items[0].name).toBe('Empresa Original');
    expect(list.items[0].email).toBe('orig@x.com');
    expect(list.items[0].notes).toBe('nota nova');
    expect(list.items[0].source).toBe('manual');
  });

  it('retorna 400 quando faltam colunas obrigatórias', async () => {
    const csv = `nome\nA\n`;
    await expect(importLeadsFromCsv(Buffer.from(csv))).rejects.toMatchObject({ status: 400 });
  });

  it('aceita CPF mascarado como CNPJ (14 dig com leading zeros)', async () => {
    // 00001850379092 = 4 zeros + 01850379092 (CPF válido). Caso real reportado
    // por Fernando — Excel/planilha pad CPF a 14 dígitos pra ficar como CNPJ.
    const csv = `name,cnpj\nSuelen Toller Melo,00001850379092\n`;
    const report = await importLeadsFromCsv(Buffer.from(csv));
    expect(report.inserted).toBe(1);
    expect(report.rejected).toEqual([]);
    const list = await listLeads({ q: '01850379092' });
    expect(list.items).toHaveLength(1);
    expect(list.items[0].cnpj).toBe('01850379092'); // canônico (11 dig CPF)
  });
});

describe('closeLeadNoDeal', () => {
  let leadId: string; let userId: string;
  beforeEach(async () => {
    const [u] = await db.insert((await import('../db/schema')).users).values({
      email: `closeur-${Date.now()}@x.com`, name: 'V', role: 'comercial', passwordHash: 'x',
    }).returning({ id: (await import('../db/schema')).users.id });
    userId = u.id;
    const [l] = await db.insert((await import('../db/schema')).leads).values({ name: 'Lead Close', phone: '5511000000001' })
      .returning({ id: (await import('../db/schema')).leads.id });
    leadId = l.id;
  });

  it('encerra lead com feedback bad', async () => {
    await closeLeadNoDeal({ leadId, actorUserId: userId, reason: 'Cliente não quer mais', quality: 'bad' });
    const schema = await import('../db/schema');
    const { eq } = await import('drizzle-orm');
    const [row] = await db.select().from(schema.leads).where(eq(schema.leads.id, leadId)).limit(1);
    expect(row.flowStage).toBe('lost');
    expect(row.closedNoDealQuality).toBe('bad');
    expect(row.closedNoDealBy).toBe(userId);
    expect(row.closedNoDealAt).toBeInstanceOf(Date);
    expect(row.closedNoDealReason).toBe('Cliente não quer mais');
  });

  it('rejeita se lead já tem deal', async () => {
    // criar deal primeiro
    const { createDeal } = await import('../services/dealsService');
    await createDeal({ leadId, ownerUserId: userId, source: 'manual', proposalValue: 100 });
    await expect(
      closeLeadNoDeal({ leadId, actorUserId: userId, reason: 'x', quality: 'good' }),
    ).rejects.toThrow(/already has a deal/i);
  });
});
