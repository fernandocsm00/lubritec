import { describe, it, expect, vi, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';

vi.mock('../services/geminiClient', () => ({
  extractBudgetFromImage: vi.fn(),
}));
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  readFile: vi.fn(async () => Buffer.from('fake-image-bytes')),
}));

import { readFile } from 'node:fs/promises';
import { extractBudgetFromImage } from '../services/geminiClient';
import { detectBudgetFromMessage } from '../services/budgetDetection';
import { db } from '../db/client';
import { budgetDetections, deals, dealActivities } from '../db/schema';
import {
  createLead,
  createConversation,
  createMessage,
  createUser,
  createDeal,
} from './helpers';
import type { DealStage } from '@shared/types';

beforeEach(() => {
  vi.mocked(extractBudgetFromImage).mockReset();
  vi.mocked(readFile).mockReset();
  vi.mocked(readFile).mockResolvedValue(Buffer.from('fake-image-bytes'));
});

let seq = 0;

/**
 * Monta o cenario real: vendedor logado manda o print de orcamento numa conversa
 * da fila Comercial de um lead que ja tem card no pipeline.
 */
async function scenario(opts: {
  stage?: DealStage;
  proposalValue?: number | null;
  withDeal?: boolean;
  sentByUser?: boolean;
}) {
  seq += 1;
  const phone = `5511930${String(100000 + seq).slice(-6)}`;
  const seller = await createUser({ email: `seller-${seq}@x.com`, role: 'comercial' });
  const lead = await createLead({ phone });
  const conv = await createConversation({ phone, leadId: lead.id, queue: 'comercial' });
  if (opts.withDeal !== false) {
    await createDeal({
      leadId: lead.id,
      stage: opts.stage ?? 'lead_no_comercial',
      proposalValue: opts.proposalValue ?? null,
      ownerUserId: seller.id,
    });
  }
  const msg = await createMessage({
    conversationId: conv.id,
    direction: 'out',
    kind: 'image',
    mediaUrl: '/uploads/conversations/orcamento.png',
    mediaMime: 'image/png',
    sentByUserId: opts.sentByUser === false ? null : seller.id,
  });
  return { lead, msg, seller };
}

async function dealRow(leadId: string) {
  const [d] = await db.select().from(deals).where(eq(deals.leadId, leadId));
  return d;
}

async function detectionRow(leadId: string) {
  const [d] = await db.select().from(budgetDetections).where(eq(budgetDetections.leadId, leadId));
  return d;
}

describe('aplicacao automatica do orcamento no card', () => {
  it('grava o valor e move de "lead no comercial" para "proposta enviada"', async () => {
    vi.mocked(extractBudgetFromImage).mockResolvedValue({ total: 9598, rotulo: 'Valor total' });
    const { lead, msg } = await scenario({ stage: 'lead_no_comercial' });

    await detectBudgetFromMessage(msg.id);

    const deal = await dealRow(lead.id);
    expect(Number(deal.proposalValue)).toBe(9598);
    expect(deal.stage).toBe('proposta_enviada');
  });

  it('marca a deteccao como confirmada — nao sobra card pedindo confirmacao', async () => {
    vi.mocked(extractBudgetFromImage).mockResolvedValue({ total: 9598, rotulo: 'Valor total' });
    const { lead, msg, seller } = await scenario({ stage: 'lead_no_comercial' });

    await detectBudgetFromMessage(msg.id);

    const det = await detectionRow(lead.id);
    expect(det.status).toBe('confirmed');
    expect(Number(det.confirmedValue)).toBe(9598);
    // Auditoria: fica registrado que a acao saiu do print daquele vendedor.
    expect(det.resolvedBy).toBe(seller.id);
  });

  it('NAO rebaixa o funil: deal em negociacao recebe o valor e mantem a etapa', async () => {
    // Orcamento revisado durante a negociacao nao pode puxar o card pra tras.
    vi.mocked(extractBudgetFromImage).mockResolvedValue({ total: 12000, rotulo: 'Valor total' });
    const { lead, msg } = await scenario({ stage: 'em_negociacao', proposalValue: 9598 });

    await detectBudgetFromMessage(msg.id);

    const deal = await dealRow(lead.id);
    expect(deal.stage).toBe('em_negociacao');
    expect(Number(deal.proposalValue)).toBe(12000);
  });

  it('deal ja em proposta enviada: so atualiza o valor', async () => {
    vi.mocked(extractBudgetFromImage).mockResolvedValue({ total: 7000, rotulo: 'Total geral' });
    const { lead, msg } = await scenario({ stage: 'proposta_enviada', proposalValue: 5000 });

    await detectBudgetFromMessage(msg.id);

    const deal = await dealRow(lead.id);
    expect(deal.stage).toBe('proposta_enviada');
    expect(Number(deal.proposalValue)).toBe(7000);
  });

  it('nao mexe em deal ganho — o valor da venda fechada e intocavel', async () => {
    vi.mocked(extractBudgetFromImage).mockResolvedValue({ total: 111, rotulo: 'Valor total' });
    const { lead, msg } = await scenario({ stage: 'ganho', proposalValue: 8000 });

    await detectBudgetFromMessage(msg.id);

    const deal = await dealRow(lead.id);
    expect(deal.stage).toBe('ganho');
    expect(Number(deal.proposalValue)).toBe(8000);
    // Sem card ativo pra aplicar: sobra pendente pro humano decidir.
    expect((await detectionRow(lead.id)).status).toBe('pending');
  });

  it('sem deal no pipeline: deixa pendente em vez de criar card sozinho', async () => {
    vi.mocked(extractBudgetFromImage).mockResolvedValue({ total: 4000, rotulo: 'Valor total' });
    const { lead, msg } = await scenario({ withDeal: false });

    await detectBudgetFromMessage(msg.id);

    expect(await dealRow(lead.id)).toBeUndefined();
    expect((await detectionRow(lead.id)).status).toBe('pending');
  });

  it('sem vendedor identificado na mensagem: deixa pendente', async () => {
    // Disparo automatico nao tem autor humano — sem actor nao ha a quem
    // atribuir a mudanca no log do deal, entao vira sugestao.
    vi.mocked(extractBudgetFromImage).mockResolvedValue({ total: 4000, rotulo: 'Valor total' });
    const { lead, msg } = await scenario({ stage: 'lead_no_comercial', sentByUser: false });

    await detectBudgetFromMessage(msg.id);

    const deal = await dealRow(lead.id);
    expect(deal.stage).toBe('lead_no_comercial');
    expect(deal.proposalValue).toBeNull();
    expect((await detectionRow(lead.id)).status).toBe('pending');
  });

  it('registra no historico do card de onde veio o valor', async () => {
    vi.mocked(extractBudgetFromImage).mockResolvedValue({ total: 9598, rotulo: 'Valor total' });
    const { lead, msg } = await scenario({ stage: 'lead_no_comercial' });

    await detectBudgetFromMessage(msg.id);

    const deal = await dealRow(lead.id);
    const acts = await db
      .select()
      .from(dealActivities)
      .where(eq(dealActivities.dealId, deal.id));
    const kinds = acts.map((a) => a.kind);
    expect(kinds).toContain('value_changed');
    expect(kinds).toContain('stage_changed');
  });
});
