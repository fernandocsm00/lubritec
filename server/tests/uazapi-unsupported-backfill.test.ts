import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { messages } from '../db/schema';
import { recoverUnsupportedInbound } from '../services/whatsapp/uazapi/unsupportedInboundBackfill';
import { createLead, createConversation, createMessage } from './helpers';

const LABEL = '📎 Mensagem não suportada';

/** Payload bruto como o webhook da UazAPI grava em raw_payload (corpo inteiro). */
function rawPayload(message: Record<string, unknown>) {
  return {
    EventType: 'messages',
    message: {
      id: `5554923677475:${Math.random().toString(36).slice(2)}`,
      fromMe: false,
      isGroup: false,
      chatid: '5571927501332@s.whatsapp.net',
      sender_pn: '5571927501332@s.whatsapp.net',
      mediaType: '',
      messageTimestamp: 1790258428000,
      ...message,
    },
  };
}

async function unsupportedMessage(opts: { rawPayload: unknown; provider?: 'uazapi' | 'meta_cloud' }) {
  const lead = await createLead({});
  const conv = await createConversation({ leadId: lead.id });
  return createMessage({
    conversationId: conv.id,
    direction: 'in',
    kind: 'unknown',
    body: LABEL,
    provider: opts.provider ?? 'uazapi',
    rawPayload: opts.rawPayload,
  });
}

async function bodyOf(id: string) {
  const [m] = await db.select({ body: messages.body }).from(messages).where(eq(messages.id, id));
  return m.body;
}

describe('recoverUnsupportedInbound', () => {
  it('simulação: lista o texto recuperado sem gravar nada', async () => {
    const msg = await unsupportedMessage({
      rawPayload: rawPayload({ type: 'text', messageType: 'TemplateMessage', text: 'Abrimos uma cotação.' }),
    });

    const r = await recoverUnsupportedInbound({ apply: false });

    expect(r.recovered).toEqual([{ id: msg.id, body: 'Abrimos uma cotação.' }]);
    expect(await bodyOf(msg.id)).toBe(LABEL);
  });

  it('com apply: grava o texto recuperado', async () => {
    const msg = await unsupportedMessage({
      rawPayload: rawPayload({ type: 'reaction', messageType: 'ReactionMessage', text: '👍' }),
    });

    await recoverUnsupportedInbound({ apply: true });

    expect(await bodyOf(msg.id)).toBe('Reagiu com 👍');
  });

  it('não mexe no que continua sem texto nem em outras linhas', async () => {
    const semTexto = await unsupportedMessage({
      rawPayload: rawPayload({ type: 'unknown', messageType: 'FutureMessage', text: '' }),
    });
    const meta = await unsupportedMessage({
      provider: 'meta_cloud',
      rawPayload: rawPayload({ type: 'text', messageType: 'TemplateMessage', text: 'não é UazAPI' }),
    });

    const r = await recoverUnsupportedInbound({ apply: true });

    expect(r.recovered).toEqual([]);
    expect(await bodyOf(semTexto.id)).toBe(LABEL);
    expect(await bodyOf(meta.id)).toBe(LABEL);
  });
});
