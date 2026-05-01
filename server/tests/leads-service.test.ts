import { describe, it, expect } from 'vitest';
import { createLead, updateLead, deleteLead, listLeads } from '../services/leadsService';
import { parseLeadsCsv, importLeadsFromCsv } from '../services/leadsImport';
import { createLead as seedLead } from './helpers';

describe('createLead', () => {
  it('cria lead com defaults frio/manual', async () => {
    const lead = await createLead({ name: 'Maria', phone: '11999998888' });
    expect(lead.status).toBe('frio');
    expect(lead.source).toBe('manual');
    expect(lead.phone).toBe('11999998888');
    expect(lead.id).toBeDefined();
  });

  it('normaliza phone (remove não-dígitos)', async () => {
    const lead = await createLead({ name: 'Joao', phone: '(11) 99999-7777' });
    expect(lead.phone).toBe('11999997777');
  });

  it('rejeita phone duplicado com 409', async () => {
    await createLead({ name: 'A', phone: '11999996666' });
    await expect(createLead({ name: 'B', phone: '11999996666' })).rejects.toMatchObject({
      status: 409,
    });
  });

  it('aceita campos opcionais', async () => {
    const lead = await createLead({
      name: 'Carlos',
      phone: '11888887777',
      email: 'carlos@x.com',
      notes: 'cliente VIP',
      vehiclePlate: 'ABC1D23',
      vehicleModel: 'Civic',
      lastPurchaseDate: '2026-01-15',
      avgMileagePerDay: 80,
    });
    expect(lead.email).toBe('carlos@x.com');
    expect(lead.notes).toBe('cliente VIP');
    expect(lead.vehiclePlate).toBe('ABC1D23');
    expect(lead.lastPurchaseDate).toBe('2026-01-15');
    expect(lead.avgMileagePerDay).toBe(80);
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

  it('404 quando id não existe', async () => {
    await expect(deleteLead('00000000-0000-0000-0000-000000000000')).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('listLeads', () => {
  it('paginação retorna 50 e total correto', async () => {
    for (let i = 0; i < 60; i++) {
      await seedLead({ phone: `551199990${String(i).padStart(4, '0')}`, name: `Lead ${i}` });
    }
    const page1 = await listLeads({ page: 1 });
    expect(page1.items).toHaveLength(50);
    expect(page1.total).toBe(60);
    expect(page1.pageSize).toBe(50);
    const page2 = await listLeads({ page: 2 });
    expect(page2.items).toHaveLength(10);
  });

  it('filtra por status', async () => {
    await seedLead({ phone: '11000000001', status: 'frio' });
    await seedLead({ phone: '11000000002', status: 'morno' });
    await seedLead({ phone: '11000000003', status: 'quente' });
    const res = await listLeads({ status: 'morno' });
    expect(res.total).toBe(1);
    expect(res.items[0].status).toBe('morno');
  });

  it('filtra por source', async () => {
    await seedLead({ phone: '11000000010', source: 'manual' });
    await seedLead({ phone: '11000000011', source: 'csv' });
    const res = await listLeads({ source: 'csv' });
    expect(res.total).toBe(1);
    expect(res.items[0].source).toBe('csv');
  });

  it('busca por name (q)', async () => {
    await seedLead({ name: 'Antonio Silva', phone: '11000000020' });
    await seedLead({ name: 'Beatriz Souza', phone: '11000000021' });
    const res = await listLeads({ q: 'Antonio' });
    expect(res.total).toBe(1);
    expect(res.items[0].name).toBe('Antonio Silva');
  });

  it('busca por phone (q)', async () => {
    await seedLead({ name: 'X', phone: '11000000030' });
    const res = await listLeads({ q: '030' });
    expect(res.total).toBe(1);
  });

  it('busca por placa (q)', async () => {
    await seedLead({ name: 'Y', phone: '11000000040', vehiclePlate: 'ABC1D23' });
    const res = await listLeads({ q: 'ABC1D23' });
    expect(res.total).toBe(1);
  });

  it('sort por name asc', async () => {
    await seedLead({ name: 'Charlie', phone: '11000000050' });
    await seedLead({ name: 'Alice', phone: '11000000051' });
    await seedLead({ name: 'Bob', phone: '11000000052' });
    const res = await listLeads({ sort: 'name', order: 'asc' });
    expect(res.items.map((l) => l.name)).toEqual(['Alice', 'Bob', 'Charlie']);
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
    const csv = `name,phone,email\nAlice,11999990001,a@x.com\nBob,11999990002,\n`;
    const { rows, rejected, missingHeaders } = await parseLeadsCsv(Buffer.from(csv));
    expect(missingHeaders).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: 'Alice', phone: '11999990001', email: 'a@x.com' });
    expect(rows[1].email).toBeNull();
    expect(rejected).toEqual([]);
  });

  it('aceita header PT com ponto-e-vírgula', async () => {
    const csv = `nome;telefone;placa\nMaria;(11) 99999-0003;ABC1D23\n`;
    const { rows, rejected, missingHeaders } = await parseLeadsCsv(Buffer.from(csv));
    expect(missingHeaders).toEqual([]);
    expect(rows[0]).toMatchObject({
      name: 'Maria',
      phone: '11999990003',
      vehiclePlate: 'ABC1D23',
    });
    expect(rejected).toEqual([]);
  });

  it('rejeita linha com phone vazio', async () => {
    const csv = `name,phone\nA,11999990010\nB,\n`;
    const { rows, rejected } = await parseLeadsCsv(Buffer.from(csv));
    expect(rows).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].line).toBe(3);
    expect(rejected[0].reason).toMatch(/phone/i);
  });

  it('rejeita linha com email inválido', async () => {
    const csv = `name,phone,email\nA,11999990020,bad-email\n`;
    const { rejected } = await parseLeadsCsv(Buffer.from(csv));
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatch(/email/i);
  });

  it('rejeita avg_mileage_per_day não numérico', async () => {
    const csv = `name,phone,km_dia\nA,11999990030,abc\n`;
    const { rejected } = await parseLeadsCsv(Buffer.from(csv));
    expect(rejected).toHaveLength(1);
  });

  it('aceita data DD/MM/YYYY e converte para ISO', async () => {
    const csv = `name,phone,ultima_compra\nA,11999990040,15/03/2025\n`;
    const { rows } = await parseLeadsCsv(Buffer.from(csv));
    expect(rows[0].lastPurchaseDate).toBe('2025-03-15');
  });

  it('reporta missingHeaders quando faltam name ou phone', async () => {
    const csv = `nome,email\nA,a@x.com\n`;
    const { missingHeaders } = await parseLeadsCsv(Buffer.from(csv));
    expect(missingHeaders).toContain('phone');
  });

  it('ignora colunas extras', async () => {
    const csv = `name,phone,foo,bar\nA,11999990050,x,y\n`;
    const { rows, rejected } = await parseLeadsCsv(Buffer.from(csv));
    expect(rows).toHaveLength(1);
    expect(rejected).toEqual([]);
  });

  it('aceita arquivo com BOM UTF-8 (Excel)', async () => {
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const csv = Buffer.concat([bom, Buffer.from('name,phone\nAlice,11999990060\n')]);
    const { rows, missingHeaders } = await parseLeadsCsv(csv);
    expect(missingHeaders).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Alice');
  });
});

describe('importLeadsFromCsv', () => {
  it('insere linhas novas com source=csv e status=frio', async () => {
    const csv = `name,phone\nA,11888880001\nB,11888880002\n`;
    const report = await importLeadsFromCsv(Buffer.from(csv));
    expect(report.inserted).toBe(2);
    expect(report.updated).toBe(0);
    expect(report.skipped).toBe(0);
    expect(report.rejected).toEqual([]);
    const list = await listLeads({ source: 'csv' });
    expect(list.total).toBe(2);
    expect(list.items[0].status).toBe('frio');
  });

  it('upsert seletivo: preenche só campos vazios, nunca sobrescreve', async () => {
    await seedLead({
      name: 'Maria Original',
      phone: '11888880010',
      email: 'maria@x.com',
      notes: null,
      source: 'manual',
    });
    const csv = `name,phone,email,notes\nMaria CSV,11888880010,csv@x.com,nota nova\n`;
    const report = await importLeadsFromCsv(Buffer.from(csv));
    expect(report.inserted).toBe(0);
    expect(report.updated).toBe(1);
    const list = await listLeads({ q: '11888880010' });
    expect(list.items[0].name).toBe('Maria Original');
    expect(list.items[0].email).toBe('maria@x.com');
    expect(list.items[0].notes).toBe('nota nova');
    expect(list.items[0].source).toBe('manual');
  });

  it('linhas inválidas viram rejected, não abortam', async () => {
    const csv = `name,phone\nA,11888880020\n,11888880021\nB,11888880022\n`;
    const report = await importLeadsFromCsv(Buffer.from(csv));
    expect(report.inserted).toBe(2);
    expect(report.rejected).toHaveLength(1);
    expect(report.rejected[0].line).toBe(3);
  });

  it('retorna missingHeaders quando faltam obrigatórias (sem persistir)', async () => {
    const csv = `nome\nA\n`;
    await expect(importLeadsFromCsv(Buffer.from(csv))).rejects.toMatchObject({ status: 400 });
  });
});
