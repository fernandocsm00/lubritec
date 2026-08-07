import { describe, it, expect, vi, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';

vi.mock('../services/notifications', () => ({
  emitNotification: vi.fn(async () => {}),
}));

import { emitNotification } from '../services/notifications';
import { processPendingReplies } from '../services/pendingReplyWatch';
import { db } from '../db/client';
import { conversationReplyAlerts, conversations, orgSettings } from '../db/schema';
import { createUser, createLead, createConversation } from './helpers';

beforeEach(async () => {
  vi.mocked(emitNotification).mockClear();
  // Janela comercial 24/7-equivalente: os testes criam conversas "N minutos
  // atras" em tempo CORRIDO e assumem que isso bate com minutos COMERCIAIS.
  // Fora do expediente configurado (default seg-sex 08-18) isso quebraria de
  // forma dependente do horario em que a suite roda. Abrindo todos os 7 dias,
  // 0-24h, corrido == comercial sempre.
  await db.update(orgSettings).set({
    aiBusinessHoursStart: 0,
    aiBusinessHoursEnd: 24,
    aiBusinessHoursDays: '1,2,3,4,5,6,7',
  }).where(eq(orgSettings.singleton, true));
});

let seq = 0;

/**
 * Cria conversa com a bola do nosso lado há `minutosAtras` de tempo CORRIDO.
 * Os testes usam horários dentro do expediente pra que corrido == comercial.
 */
async function pendente(opts: { minutosAtras: number; comDono?: boolean }) {
  seq += 1;
  const phone = `5511960${String(100000 + seq).slice(-6)}`;
  const dono = opts.comDono === false ? null : await createUser({ email: `dono-${seq}@x.com`, role: 'comercial' });
  const lead = await createLead({ phone });
  const ts = new Date(Date.now() - opts.minutosAtras * 60_000);
  const conv = await createConversation({
    phone,
    leadId: lead.id,
    queue: 'comercial',
    status: 'em_atendimento',
    assignedTo: dono?.id ?? null,
    lastInboundAt: ts,
    lastMessageAt: ts,
  });
  return { conv, dono };
}

async function alertas(convId: string) {
  return db.select().from(conversationReplyAlerts)
    .where(eq(conversationReplyAlerts.conversationId, convId));
}

describe('processPendingReplies', () => {
  it('não alerta antes do prazo', async () => {
    const { conv } = await pendente({ minutosAtras: 10 });
    await processPendingReplies();
    expect(await alertas(conv.id)).toHaveLength(0);
  });

  it('alerta o DONO da conversa ao cruzar o prazo', async () => {
    const { conv, dono } = await pendente({ minutosAtras: 90 });

    await processPendingReplies();

    const rows = await alertas(conv.id);
    expect(rows.map((r) => r.level)).toContain(1);
    const chamada = vi.mocked(emitNotification).mock.calls
      .map((c) => c[0])
      .find((a) => a.kind === 'pending_reply');
    expect(chamada?.userIds).toEqual([dono!.id]);
  });

  it('conversa sem dono alerta todos da fila Comercial', async () => {
    const { conv } = await pendente({ minutosAtras: 90, comDono: false });

    await processPendingReplies();

    const chamada = vi.mocked(emitNotification).mock.calls
      .map((c) => c[0])
      .find((a) => a.metadata?.conversationId === conv.id);
    expect(chamada?.toRoles).toEqual(['comercial']);
    expect(chamada?.userIds ?? []).toEqual([]);
  });

  it('escala pro admin no segundo prazo, sem repetir o nível 1', async () => {
    const { conv } = await pendente({ minutosAtras: 240 });

    await processPendingReplies();

    const rows = await alertas(conv.id);
    expect(rows.map((r) => r.level).sort()).toEqual([1, 2]);
    const escalada = vi.mocked(emitNotification).mock.calls
      .map((c) => c[0])
      .find((a) => a.metadata?.level === 2);
    expect(escalada?.toRoles).toEqual(['admin']);
  });

  it('dois ticks seguidos não duplicam alerta', async () => {
    const { conv } = await pendente({ minutosAtras: 90 });

    await processPendingReplies();
    const depoisDoPrimeiro = vi.mocked(emitNotification).mock.calls.length;
    await processPendingReplies();

    expect(vi.mocked(emitNotification).mock.calls.length).toBe(depoisDoPrimeiro);
    expect(await alertas(conv.id)).toHaveLength(1);
  });

  it('mensagem NOVA do cliente abre um ciclo e volta a alertar', async () => {
    // O caso que a coluna pending_since existe pra cobrir. Sem ela a conversa
    // alertaria uma vez na vida e o sistema pararia de avisar justamente nas
    // conversas mais ativas.
    const { conv } = await pendente({ minutosAtras: 90 });
    await processPendingReplies();

    // Respondemos e o cliente escreveu de novo, 90 min atrás.
    const novoInbound = new Date(Date.now() - 90 * 60_000);
    await db.update(conversations)
      .set({ lastInboundAt: novoInbound, lastMessageAt: novoInbound })
      .where(eq(conversations.id, conv.id));

    await processPendingReplies();

    const rows = await alertas(conv.id);
    expect(rows.filter((r) => r.level === 1)).toHaveLength(2);
  });

  it('não alerta conversa que já respondemos', async () => {
    const { conv } = await pendente({ minutosAtras: 90 });
    await db.update(conversations)
      .set({ lastMessageAt: new Date() })
      .where(eq(conversations.id, conv.id));

    await processPendingReplies();

    expect(await alertas(conv.id)).toHaveLength(0);
  });
});
