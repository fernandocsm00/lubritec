import { describe, it, expect } from 'vitest';
import { createLead, updateLead, deleteLead, listLeads } from '../services/leadsService';
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
