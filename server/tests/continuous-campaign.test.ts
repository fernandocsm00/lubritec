import { describe, it, expect, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { campaigns, campaignRecipients, leads, orgSettings } from '../db/schema';
import {
  enrollLeadInContinuous,
  isWithinDispatchWindow,
  pickVariant,
  upsertContinuousCampaign,
} from '../services/continuousCampaign';
import { createUser, createLead, createConversation, createMessage } from './helpers';
import { filterEligibleLeads as _ensureCooldownImport } from '../services/campaignsCooldown';
void _ensureCooldownImport;

async function setDispatchWindow(opts: {
  startHour?: number;
  endHour?: number;
  skipWeekends?: boolean;
  timezone?: string;
}) {
  await db.update(orgSettings).set({
    dispatchStartHour: opts.startHour ?? 8,
    dispatchEndHour: opts.endHour ?? 18,
    dispatchSkipWeekends: opts.skipWeekends ?? true,
    dispatchTimezone: opts.timezone ?? 'America/Sao_Paulo',
  }).where(eq(orgSettings.singleton, true));
}

describe('isWithinDispatchWindow', () => {
  it('ok=true em terça às 10h Sao_Paulo', async () => {
    await setDispatchWindow({ startHour: 8, endHour: 18 });
    // 2026-05-05 é terça-feira; 13:00 UTC = 10:00 Sao_Paulo (UTC-3).
    const now = new Date('2026-05-05T13:00:00Z');
    const r = await isWithinDispatchWindow(now);
    expect(r.ok).toBe(true);
  });

  it('ok=false antes do horário (5h Sao_Paulo, janela 8-18)', async () => {
    await setDispatchWindow({ startHour: 8, endHour: 18 });
    const now = new Date('2026-05-05T08:00:00Z'); // 5h SP
    const r = await isWithinDispatchWindow(now);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('before_start');
  });

  it('ok=false após horário (20h Sao_Paulo, janela 8-18)', async () => {
    await setDispatchWindow({ startHour: 8, endHour: 18 });
    const now = new Date('2026-05-05T23:00:00Z'); // 20h SP
    const r = await isWithinDispatchWindow(now);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('after_end');
  });

  it('ok=false em sábado quando skipWeekends=true', async () => {
    await setDispatchWindow({ startHour: 0, endHour: 24, skipWeekends: true });
    const now = new Date('2026-05-09T13:00:00Z'); // sábado
    const r = await isWithinDispatchWindow(now);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('weekend');
  });

  it('ok=true em sábado quando skipWeekends=false', async () => {
    await setDispatchWindow({ startHour: 0, endHour: 24, skipWeekends: false });
    const now = new Date('2026-05-09T13:00:00Z');
    const r = await isWithinDispatchWindow(now);
    expect(r.ok).toBe(true);
  });
});

describe('pickVariant', () => {
  it('retorna messageBody quando variants vazio', () => {
    const c = {
      messageBody: 'Olá!',
      mediaUrl: null,
      mediaMime: null,
      messageVariants: null,
    } as Parameters<typeof pickVariant>[0];
    const r = pickVariant(c);
    expect(r.body).toBe('Olá!');
  });

  it('retorna uma variant quando variants tem itens', () => {
    const c = {
      messageBody: 'fallback',
      mediaUrl: null,
      mediaMime: null,
      messageVariants: [
        { name: 'A', body: 'Versão A' },
        { name: 'B', body: 'Versão B' },
      ],
    } as Parameters<typeof pickVariant>[0];
    // Math.random determinístico
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0); // primeira
    expect(pickVariant(c).body).toBe('Versão A');
    spy.mockReturnValue(0.99); // última
    expect(pickVariant(c).body).toBe('Versão B');
    spy.mockRestore();
  });
});

describe('upsertContinuousCampaign', () => {
  it('cria a campanha singleton quando não existe', async () => {
    const u = await createUser({ role: 'admin' });
    const r = await upsertContinuousCampaign(u.id, {
      name: 'Test Cont',
      messageBody: 'olá {{nome}}',
    });
    expect(r.id).toBeDefined();
    expect(r.name).toBe('Test Cont');
    expect(r.status).toBe('paused');
  });

  it('atualiza a campanha singleton quando já existe', async () => {
    const u = await createUser({ role: 'admin' });
    const c1 = await upsertContinuousCampaign(u.id, { messageBody: 'v1' });
    const c2 = await upsertContinuousCampaign(u.id, { messageBody: 'v2', status: 'running' });
    expect(c1.id).toBe(c2.id);
    expect(c2.messageBody).toBe('v2');
    expect(c2.status).toBe('running');
  });

  it('rejeita >10 variants', async () => {
    const u = await createUser({ role: 'admin' });
    const variants = Array.from({ length: 11 }, (_, i) => ({ body: `v${i}` }));
    await expect(upsertContinuousCampaign(u.id, { messageVariants: variants })).rejects.toThrow(/Máximo 10/);
  });
});

describe('enrollLeadInContinuous', () => {
  it('no_continuous_campaign quando não há campanha', async () => {
    const lead = await createLead({ phone: '5511900000010' });
    const r = await enrollLeadInContinuous(lead.id);
    expect(r.status).toBe('no_continuous_campaign');
  });

  it('campaign_paused quando status=paused', async () => {
    const u = await createUser({ role: 'admin' });
    await upsertContinuousCampaign(u.id, { messageBody: 'oi', status: 'paused' });
    const lead = await createLead({ phone: '5511900000011' });
    const r = await enrollLeadInContinuous(lead.id);
    expect(r.status).toBe('campaign_paused');
  });

  it('lead_no_phone quando lead sem phone', async () => {
    const u = await createUser({ role: 'admin' });
    await upsertContinuousCampaign(u.id, { messageBody: 'oi', status: 'running' });
    const lead = await createLead({ phone: null });
    const r = await enrollLeadInContinuous(lead.id);
    expect(r.status).toBe('lead_no_phone');
  });

  it('lead_not_complete quando stage diferente', async () => {
    const u = await createUser({ role: 'admin' });
    await upsertContinuousCampaign(u.id, { messageBody: 'oi', status: 'running' });
    const lead = await createLead({ phone: '5511900000012', flowStage: 'engaged' });
    const r = await enrollLeadInContinuous(lead.id);
    expect(r.status).toBe('lead_not_complete');
    if (r.status === 'lead_not_complete') {
      expect(r.currentStage).toBe('engaged');
    }
  });

  it('enrolled quando lead complete + cria recipient pending', async () => {
    const u = await createUser({ role: 'admin' });
    const camp = await upsertContinuousCampaign(u.id, { messageBody: 'oi', status: 'running' });
    const lead = await createLead({ phone: '5511900000013', flowStage: 'complete' });

    const r = await enrollLeadInContinuous(lead.id);
    expect(r.status).toBe('enrolled');

    const [recipient] = await db.select().from(campaignRecipients)
      .where(eq(campaignRecipients.leadId, lead.id));
    expect(recipient).toBeDefined();
    expect(recipient.campaignId).toBe(camp.id);
    expect(recipient.status).toBe('pending');
    expect(recipient.phone).toBe('5511900000013');
  });

  it('already_enrolled em chamada idempotente', async () => {
    const u = await createUser({ role: 'admin' });
    await upsertContinuousCampaign(u.id, { messageBody: 'oi', status: 'running' });
    const lead = await createLead({ phone: '5511900000014', flowStage: 'complete' });

    await enrollLeadInContinuous(lead.id);
    const r2 = await enrollLeadInContinuous(lead.id);
    expect(r2.status).toBe('already_enrolled');

    const recipients = await db.select().from(campaignRecipients)
      .where(eq(campaignRecipients.leadId, lead.id));
    expect(recipients).toHaveLength(1);
  });

  it('audience_total incrementa em cada enroll', async () => {
    const u = await createUser({ role: 'admin' });
    const c = await upsertContinuousCampaign(u.id, { messageBody: 'oi', status: 'running' });
    const before = (await db.select({ total: campaigns.audienceTotal }).from(campaigns).where(eq(campaigns.id, c.id)))[0].total;

    const lead = await createLead({ phone: '5511900000015', flowStage: 'complete' });
    await enrollLeadInContinuous(lead.id);

    const after = (await db.select({ total: campaigns.audienceTotal }).from(campaigns).where(eq(campaigns.id, c.id)))[0].total;
    expect(after).toBe(before + 1);
  });
});

describe('createLead auto-enroll', () => {
  it('lead criado com phone enrola na contínua ativa', async () => {
    const u = await createUser({ role: 'admin' });
    await upsertContinuousCampaign(u.id, { messageBody: 'oi', status: 'running' });

    // Importa createLead dinamicamente pra evitar reorder
    const { createLead: svcCreateLead } = await import('../services/leadsService');
    const created = await svcCreateLead({
      name: 'Test Co',
      phone: '5511900000020',
      cnpj: '11444777000161', // Banco do Brasil — válido
    });

    const recipients = await db.select().from(campaignRecipients).where(eq(campaignRecipients.leadId, created.id));
    expect(recipients).toHaveLength(1);
  });

  it('lead criado SEM phone NÃO enrola', async () => {
    const u = await createUser({ role: 'admin' });
    await upsertContinuousCampaign(u.id, { messageBody: 'oi', status: 'running' });

    const { createLead: svcCreateLead } = await import('../services/leadsService');
    const created = await svcCreateLead({
      name: 'Test Co',
      cnpj: '00360305000104', // Caixa — válido
    });

    const recipients = await db.select().from(campaignRecipients).where(eq(campaignRecipients.leadId, created.id));
    expect(recipients).toHaveLength(0);

    const [row] = await db.select().from(leads).where(eq(leads.id, created.id));
    expect(row.flowStage).toBe('incomplete');
  });
});

describe('enrollment + cooldown', () => {
  it('lead em cooldown não é enrolado (sem recipient row criado)', async () => {
    const u = await createUser({ role: 'comercial', email: 'cc-cool@x.com' });
    const lead = await createLead({ phone: '5511900090001', flowStage: 'complete' });
    const conv = await createConversation({ leadId: lead.id });
    await createMessage({
      conversationId: conv.id,
      direction: 'out',
      sentByUserId: u.id,
      sentAt: new Date(Date.now() - 60 * 60 * 1000),
    });

    const [cont] = await db.insert(campaigns).values({
      name: 'cont',
      status: 'running',
      messageBody: 'oi',
      isContinuous: true,
      createdByUserId: u.id,
    }).returning();

    const r = await enrollLeadInContinuous(lead.id);
    expect(r.status).toBe('lead_in_cooldown');

    const recs = await db.select().from(campaignRecipients)
      .where(eq(campaignRecipients.campaignId, cont.id));
    expect(recs).toHaveLength(0);
  });
});
