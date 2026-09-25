import { describe, it, expect } from 'vitest';
import { extractInbound } from '../lib/uazapiSchema';

// Payload sample reduzido inspirado em event real de figurinha capturado em prod.
// Caracteristicas-chave: type='media' generico, messageType='StickerMessage',
// mediaType='sticker', URL placeholder 'https://a.whatsapp.net', mimetype webp.
const stickerPayload = {
  EventType: 'messages',
  chat: { wa_chatid: '555194322271@s.whatsapp.net', name: 'Nicolle' },
  message: {
    id: '5554923677475:3EB0CD6231FA6A4C1ACA9D',
    text: '',
    type: 'media',
    fromMe: false,
    chatid: '555194322271@s.whatsapp.net',
    sender: '197658941640704@lid',
    sender_pn: '555194322271@s.whatsapp.net',
    senderName: 'Nicolle - Lubritec',
    mediaType: 'sticker',
    messageType: 'StickerMessage',
    isGroup: false,
    messageTimestamp: 1779909442000,
    content: {
      URL: 'https://a.whatsapp.net',
      mimetype: 'image/webp',
      directPath: '/v/t62.15575-24/566981988_xxx.enc',
      fileLength: 55578,
    },
  },
};

const textPayload = {
  EventType: 'messages',
  message: {
    id: 'abc123',
    type: 'conversation',
    messageType: 'conversation',
    fromMe: false,
    chatid: '5551999990000@s.whatsapp.net',
    sender: '5551999990000@s.whatsapp.net',
    text: 'Boa tarde',
    senderName: 'Cliente',
    messageTimestamp: 1779909500000,
  },
};

const imagePayload = {
  EventType: 'messages',
  message: {
    id: 'img-1',
    type: 'media',
    fromMe: false,
    chatid: '5551888880000@s.whatsapp.net',
    sender: '5551888880000@s.whatsapp.net',
    mediaType: 'image',
    messageType: 'ImageMessage',
    messageTimestamp: 1779909600000,
    content: {
      url: 'https://example.com/real/image.jpg',
      mimetype: 'image/jpeg',
    },
  },
};

const fromMePayload = {
  ...textPayload,
  message: { ...textPayload.message, id: 'fm-1', fromMe: true },
};

describe('extractInbound — figurinhas e fallbacks', () => {
  it('mapeia sticker pra kind=image e seta body fallback "🎞️ Figurinha"', () => {
    const out = extractInbound(stickerPayload as Record<string, unknown>);
    expect(out).not.toBeNull();
    expect(out!.kind).toBe('image');
    expect(out!.text).toBe('🎞️ Figurinha');
    // URL placeholder deve ser descartada
    expect(out!.mediaUrl).toBeNull();
    expect(out!.mediaMime).toBe('image/webp');
  });

  it('extrai texto normal sem fallback', () => {
    const out = extractInbound(textPayload as Record<string, unknown>);
    expect(out).not.toBeNull();
    expect(out!.kind).toBe('text');
    expect(out!.text).toBe('Boa tarde');
  });

  it('extrai imagem com URL real do bloco content e preserva URL', () => {
    const out = extractInbound(imagePayload as Record<string, unknown>);
    expect(out).not.toBeNull();
    expect(out!.kind).toBe('image');
    expect(out!.mediaUrl).toBe('https://example.com/real/image.jpg');
    expect(out!.mediaMime).toBe('image/jpeg');
    // Sem caption, mas com URL renderizavel — nao usa fallback
    expect(out!.text).toBeNull();
  });

  it('filtra fromMe=true (mensagens enviadas por nos)', () => {
    const out = extractInbound(fromMePayload as Record<string, unknown>);
    expect(out).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tipos que o mapKind não conhece. Até 25/09/2026 todos viravam o rótulo
// "📎 Mensagem não suportada" e o texto que a UazAPI manda era descartado — caso
// real: convite de cotação da 3p Engenharia (TemplateMessage) que ninguém leu.
// Payloads reduzidos a partir dos capturados em produção.
// ---------------------------------------------------------------------------

const templatePayload = {
  EventType: 'messages',
  chat: { wa_chatid: '5571927501332@s.whatsapp.net' },
  message: {
    id: '5554923677475:3EB0TEMPLATE01',
    type: 'text',
    text: 'Olá, tudo bem? Aqui é John Everton, da 3p Engenharia LTDA. Abrimos uma cotação e queremos incluir vocês entre os fornecedores convidados.',
    fromMe: false,
    chatid: '5571927501332@s.whatsapp.net',
    sender_pn: '5571927501332@s.whatsapp.net',
    mediaType: '',
    messageType: 'TemplateMessage',
    isGroup: false,
    messageTimestamp: 1790258428000,
    content: {
      Format: null,
      templateID: '1361348756005564',
      hydratedTemplate: { hydratedContentText: 'Olá, tudo bem? Aqui é John Everton...' },
    },
  },
};

const reactionPayload = {
  EventType: 'messages',
  message: {
    id: '5554923677475:3EB0REACTION01',
    type: 'reaction',
    text: '👍🏻',
    reaction: '3EB0D99B24F58801AECE98',
    fromMe: false,
    chatid: '5551999990000@s.whatsapp.net',
    sender_pn: '5551999990000@s.whatsapp.net',
    mediaType: '',
    messageType: 'ReactionMessage',
    isGroup: false,
    messageTimestamp: 1786046744364,
    content: { key: { ID: '3EB0D99B24F58801AECE98', fromMe: false }, text: '👍🏻' },
  },
};

describe('extractInbound — tipos que o sistema não reconhece', () => {
  it('template de empresa: grava o texto que a UazAPI mandou, não o rótulo', () => {
    const out = extractInbound(templatePayload as Record<string, unknown>);
    expect(out).not.toBeNull();
    expect(out!.text).toBe(templatePayload.message.text);
    // Continua fora do fluxo de texto (a IA só age em kind=text).
    expect(out!.kind).toBe('unknown');
  });

  it('reação: vira "Reagiu com <emoji>"', () => {
    const out = extractInbound(reactionPayload as Record<string, unknown>);
    expect(out!.text).toBe('Reagiu com 👍🏻');
  });

  it('reação removida (sem emoji) não vira mensagem', () => {
    const removed = { ...reactionPayload, message: { ...reactionPayload.message, text: '' } };
    expect(extractInbound(removed as Record<string, unknown>)).toBeNull();
  });

  it('localização sem texto: rótulo específico', () => {
    const location = {
      ...reactionPayload,
      message: { ...reactionPayload.message, type: 'location', text: '', messageType: 'LocationMessage' },
    };
    expect(extractInbound(location as Record<string, unknown>)!.text).toBe('📍 Localização');
  });

  it('tipo desconhecido sem texto nenhum: segue o rótulo genérico', () => {
    const mystery = {
      ...reactionPayload,
      message: { ...reactionPayload.message, type: 'unknown', text: '', messageType: 'FutureMessage' },
    };
    expect(extractInbound(mystery as Record<string, unknown>)!.text).toBe('📎 Mensagem não suportada');
  });
});
