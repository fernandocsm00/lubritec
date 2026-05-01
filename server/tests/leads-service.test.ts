import { describe, it, expect } from 'vitest';
import { createLead, updateLead, deleteLead } from '../services/leadsService';
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
