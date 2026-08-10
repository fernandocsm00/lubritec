import { describe, it, expect } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { conversations } from '../db/schema';
import { awaitingUsSql } from '../lib/pendingReply';
import { createLead, createConversation } from './helpers';

async function matches(convId: string): Promise<boolean> {
  const rows = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, convId), awaitingUsSql()));
  return rows.length === 1;
}

let seq = 0;
async function conv(opts: {
  queue?: 'ia' | 'recepcao' | 'comercial';
  status?: 'aguardando_atendimento' | 'em_atendimento' | 'encerrada';
  aiDisabled?: boolean;
  lastInboundAt?: Date | null;
  lastMessageAt?: Date;
}) {
  seq += 1;
  const phone = `5511940${String(100000 + seq).slice(-6)}`;
  const lead = await createLead({ phone });
  return createConversation({
    phone,
    leadId: lead.id,
    queue: opts.queue ?? 'comercial',
    status: opts.status ?? 'em_atendimento',
    aiDisabled: opts.aiDisabled ?? false,
    lastInboundAt: opts.lastInboundAt === undefined ? new Date('2026-08-05T12:00:00Z') : opts.lastInboundAt,
    lastMessageAt: opts.lastMessageAt ?? new Date('2026-08-05T12:00:00Z'),
  });
}

describe('awaitingUsSql', () => {
  it('pega conversa cuja última mensagem é do cliente', async () => {
    const c = await conv({});
    expect(await matches(c.id)).toBe(true);
  });

  it('ignora conversa que já respondemos', async () => {
    const c = await conv({ lastMessageAt: new Date('2026-08-05T12:05:00Z') });
    expect(await matches(c.id)).toBe(false);
  });

  it('ignora conversa encerrada', async () => {
    const c = await conv({ status: 'encerrada' });
    expect(await matches(c.id)).toBe(false);
  });

  it('ignora conversa da fila IA com a IA ligada', async () => {
    // A IA vai responder — não é pendência humana.
    const c = await conv({ queue: 'ia', aiDisabled: false });
    expect(await matches(c.id)).toBe(false);
  });

  it('pega conversa da recepção quando um humano assumiu (IA desligada)', async () => {
    const c = await conv({ queue: 'recepcao', aiDisabled: true });
    expect(await matches(c.id)).toBe(true);
  });

  it('ignora disparo de campanha que nunca recebeu resposta', async () => {
    // Sem inbound nenhum a bola nunca esteve conosco.
    const c = await conv({ lastInboundAt: null });
    expect(await matches(c.id)).toBe(false);
  });
});
