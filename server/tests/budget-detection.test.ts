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
import { budgetDetections } from '../db/schema';
import { createLead, createConversation, createMessage } from './helpers';

beforeEach(() => {
  vi.mocked(extractBudgetFromImage).mockReset();
  vi.mocked(readFile).mockReset();
  vi.mocked(readFile).mockResolvedValue(Buffer.from('fake-image-bytes'));
});

async function imageMessage(phone: string, mediaUrl: string | null = '/uploads/conversations/x.jpg') {
  const lead = await createLead({ phone });
  const conv = await createConversation({ phone, leadId: lead.id, queue: 'comercial' });
  const msg = await createMessage({
    conversationId: conv.id,
    direction: 'out',
    kind: 'image',
    mediaUrl,
    mediaMime: 'image/jpeg',
  });
  return { lead, conv, msg };
}

describe('detectBudgetFromMessage', () => {
  it('grava detecção pendente quando a IA lê um total', async () => {
    vi.mocked(extractBudgetFromImage).mockResolvedValue({ total: 3443.04, rotulo: 'Valor total' });
    const { lead, msg } = await imageMessage('5511900000900');

    await detectBudgetFromMessage(msg.id);

    const rows = await db.select().from(budgetDetections).where(eq(budgetDetections.leadId, lead.id));
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].detectedValue)).toBe(3443.04);
    expect(rows[0].status).toBe('pending');
    expect(rows[0].detectedLabel).toBe('Valor total');
  });

  it('não grava nada quando a IA não reconhece orçamento', async () => {
    vi.mocked(extractBudgetFromImage).mockResolvedValue(null);
    const { lead, msg } = await imageMessage('5511900000905');

    await detectBudgetFromMessage(msg.id);

    const rows = await db.select().from(budgetDetections).where(eq(budgetDetections.leadId, lead.id));
    expect(rows).toHaveLength(0);
  });

  it('detecção nova dispensa a pendente anterior do mesmo lead', async () => {
    // Orçamento revisado: o valor que vale é o do print mais recente.
    vi.mocked(extractBudgetFromImage).mockResolvedValue({ total: 1000, rotulo: 'Total' });
    const lead = await createLead({ phone: '5511900000901' });
    const conv = await createConversation({ phone: '5511900000901', leadId: lead.id, queue: 'comercial' });
    const m1 = await createMessage({
      conversationId: conv.id, direction: 'out', kind: 'image',
      mediaUrl: '/uploads/conversations/a.jpg', mediaMime: 'image/jpeg',
    });
    await detectBudgetFromMessage(m1.id);

    vi.mocked(extractBudgetFromImage).mockResolvedValue({ total: 2000, rotulo: 'Total' });
    const m2 = await createMessage({
      conversationId: conv.id, direction: 'out', kind: 'image',
      mediaUrl: '/uploads/conversations/b.jpg', mediaMime: 'image/jpeg',
    });
    await detectBudgetFromMessage(m2.id);

    const rows = await db.select().from(budgetDetections).where(eq(budgetDetections.leadId, lead.id));
    const pending = rows.filter((r) => r.status === 'pending');
    expect(pending).toHaveLength(1);
    expect(Number(pending[0].detectedValue)).toBe(2000);
    expect(rows).toHaveLength(2); // a antiga fica como histórico, dismissed
  });

  it('ignora mensagem inbound (orçamento de concorrente não é nosso número)', async () => {
    const lead = await createLead({ phone: '5511900000902' });
    const conv = await createConversation({ phone: '5511900000902', leadId: lead.id, queue: 'comercial' });
    const msg = await createMessage({
      conversationId: conv.id, direction: 'in', kind: 'image',
      mediaUrl: '/uploads/inbound/x.jpg', mediaMime: 'image/jpeg',
    });

    await detectBudgetFromMessage(msg.id);

    expect(extractBudgetFromImage).not.toHaveBeenCalled();
    const rows = await db.select().from(budgetDetections).where(eq(budgetDetections.leadId, lead.id));
    expect(rows).toHaveLength(0);
  });

  it('ignora mensagem sem mediaUrl local', async () => {
    const { msg } = await imageMessage('5511900000903', null);

    await detectBudgetFromMessage(msg.id);

    expect(extractBudgetFromImage).not.toHaveBeenCalled();
  });

  it('arquivo sumiu do disco não quebra', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));
    const { lead, msg } = await imageMessage('5511900000904');

    await expect(detectBudgetFromMessage(msg.id)).resolves.toBeUndefined();

    const rows = await db.select().from(budgetDetections).where(eq(budgetDetections.leadId, lead.id));
    expect(rows).toHaveLength(0);
  });
});
