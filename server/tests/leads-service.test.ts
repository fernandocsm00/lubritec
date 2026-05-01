import { describe, it, expect } from 'vitest';
import { createLead } from '../services/leadsService';
import { HttpError } from '../middleware/errorHandler';

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
