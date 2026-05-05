import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLead, updateLead, deleteLead, listLeads } from '../services/leadsService';
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
    expect(lead.phone).toBe('11999998888');
    expect(lead.cnpj).toBe(VALID_CNPJ_1);
    expect(lead.id).toBeDefined();
  });

  it('normaliza phone e cnpj (remove não-dígitos)', async () => {
    const lead = await createLead({
      name: 'Empresa B',
      phone: '(11) 99999-7777',
      cnpj: '00.360.305/0001-04',
    });
    expect(lead.phone).toBe('11999997777');
    expect(lead.cnpj).toBe(VALID_CNPJ_2);
  });

  it('rejeita CNPJ inválido', async () => {
    await expect(
      createLead({ name: 'X', phone: '11999996666', cnpj: '11111111111111' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejeita CNPJ duplicado com 409', async () => {
    await createLead({ name: 'A', phone: '11999996001', cnpj: VALID_CNPJ_3 });
    await expect(
      createLead({ name: 'B', phone: '11999996002', cnpj: VALID_CNPJ_3 }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('updateLead', () => {
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
    expect(rows[0]).toMatchObject({ name: 'Empresa A', phone: '11999990001', cnpj: VALID_CNPJ_1, email: 'a@x.com' });
    expect(rows[1].email).toBeNull();
    expect(rejected).toEqual([]);
  });

  it('aceita header PT com ponto-e-vírgula', async () => {
    const csv = `nome;telefone;cnpj\nEmpresa Maria;(11) 99999-0003;${VALID_CNPJ_3}\n`;
    const { rows, rejected } = await parseLeadsCsv(Buffer.from(csv));
    expect(rows[0]).toMatchObject({
      name: 'Empresa Maria',
      phone: '11999990003',
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
    const report = await importLeadsFromCsv(Buffer.from(csv));
    expect(report.inserted).toBe(2);
    expect(report.updated).toBe(0);
    expect(report.rejected).toEqual([]);
    const list = await listLeads({ source: 'csv' });
    expect(list.total).toBe(2);
    expect(list.items[0].status).toBe('frio');
  });

  it('CNPJ baixado pela BrasilAPI vira rejected', async () => {
    vi.mocked(cnpjLookup.lookupCnpj).mockResolvedValueOnce({
      cnpj: VALID_CNPJ_3,
      status: 'inactive',
      razaoSocial: null,
      situacaoCadastral: 'BAIXADA',
      telefone: null,
    });
    const csv = `name,phone,cnpj\nA,11888880010,${VALID_CNPJ_3}\n`;
    const report = await importLeadsFromCsv(Buffer.from(csv));
    expect(report.inserted).toBe(0);
    expect(report.rejected).toHaveLength(1);
    expect(report.rejected[0].reason).toMatch(/baixado|BAIXADA/i);
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
});
