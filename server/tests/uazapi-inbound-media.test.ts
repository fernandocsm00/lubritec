import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocka as bordas: download no provider, gravacao em disco e resolucao de config.
vi.mock('../services/whatsapp/uazapi/client', () => ({
  downloadUazapiMedia: vi.fn(async () => ({
    buffer: Buffer.from('jpeg-bytes'),
    mime: 'image/jpeg',
  })),
  UazapiError: class UazapiError extends Error {},
}));
vi.mock('../services/whatsapp/inboundMediaStore', () => ({
  persistInboundMedia: vi.fn(async () => '/uploads/inbound/deadbeef.jpg'),
}));
vi.mock('../services/whatsappInstanceService', () => ({
  loadSendConfig: vi.fn(async () => ({
    baseUrl: 'https://oriondigital.uazapi.com',
    instanceId: 'r842bde0e9e6b91',
    token: 'plain-token-fixo',
  })),
}));

import { downloadUazapiMedia } from '../services/whatsapp/uazapi/client';
import { persistInboundMedia } from '../services/whatsapp/inboundMediaStore';
import { loadSendConfig } from '../services/whatsappInstanceService';
import { materializeInboundMedia } from '../services/whatsapp/uazapi/inboundMedia';
import type { InboundMessage } from '../lib/uazapiSchema';

// URL real capturada em prod: CDN do WhatsApp, conteudo cifrado com mediaKey.
// Um <img src> nunca renderiza isso — e o bug que esse modulo conserta.
const WA_CDN_URL =
  'https://mmg.whatsapp.net/o1/v/t24/f2/m239/AQM97D4zI8x8CrQK-vK-1GkBOeEUIGSSvCapqnUYYZPZ?ccb=9-4&oe=6A9ADD5B&mms3=true';

function inboundImage(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    id: '555421084500:3EB06F4A82FF3F82640009',
    from: '555496838179@s.whatsapp.net',
    contactName: 'Fran Atm Moldes',
    text: null,
    kind: 'image',
    mediaUrl: WA_CDN_URL,
    mediaMime: 'image/jpeg',
    isSticker: false,
    timestamp: new Date('2026-08-05T17:33:34Z'),
    fromMe: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(downloadUazapiMedia).mockClear();
  vi.mocked(persistInboundMedia).mockClear();
  vi.mocked(loadSendConfig).mockClear();
  vi.mocked(downloadUazapiMedia).mockResolvedValue({
    buffer: Buffer.from('jpeg-bytes'),
    mime: 'image/jpeg',
  });
});

describe('materializeInboundMedia — mídia inbound da UazAPI vira arquivo local', () => {
  it('baixa a mídia decifrada e troca a URL da CDN do WhatsApp pela local', async () => {
    const inbound = inboundImage();

    await materializeInboundMedia(inbound, 'inst-fixo');

    // Baixou usando o id da mensagem + a config DA LINHA da conversa.
    expect(loadSendConfig).toHaveBeenCalledWith('inst-fixo');
    expect(downloadUazapiMedia).toHaveBeenCalledWith(
      '555421084500:3EB06F4A82FF3F82640009',
      { baseUrl: 'https://oriondigital.uazapi.com', token: 'plain-token-fixo' },
    );
    expect(persistInboundMedia).toHaveBeenCalledWith(
      Buffer.from('jpeg-bytes'),
      'image/jpeg',
    );
    // A URL gravada é a local — servida por express.static('/uploads').
    expect(inbound.mediaUrl).toBe('/uploads/inbound/deadbeef.jpg');
    expect(inbound.mediaMime).toBe('image/jpeg');
  });

  it('baixa mesmo quando o provider não mandou URL (sticker manda placeholder)', async () => {
    // extractInbound zera mediaUrl no placeholder 'https://a.whatsapp.net' e cai
    // no label fallback. O id da mensagem basta pro /message/download.
    const inbound = inboundImage({
      mediaUrl: null,
      mediaMime: 'image/webp',
      text: '🎞️ Figurinha',
      isSticker: true,
    });

    await materializeInboundMedia(inbound, 'inst-fixo');

    expect(downloadUazapiMedia).toHaveBeenCalledTimes(1);
    expect(inbound.mediaUrl).toBe('/uploads/inbound/deadbeef.jpg');
    // Com a imagem real na bolha, o label fallback vira ruído — some.
    expect(inbound.text).toBeNull();
  });

  it('preserva a legenda do cliente quando a mídia carrega', async () => {
    const inbound = inboundImage({ text: 'segue o comprovante' });

    await materializeInboundMedia(inbound, 'inst-fixo');

    expect(inbound.mediaUrl).toBe('/uploads/inbound/deadbeef.jpg');
    expect(inbound.text).toBe('segue o comprovante');
  });

  it('falha no download NÃO grava URL quebrada — cai no label fallback', async () => {
    vi.mocked(downloadUazapiMedia).mockRejectedValue(new Error('404 not found'));
    const inbound = inboundImage();

    await materializeInboundMedia(inbound, 'inst-fixo');

    // Nada de mmg.whatsapp.net no banco: melhor bolha com label que <img> quebrado.
    expect(inbound.mediaUrl).toBeNull();
    expect(inbound.text).toBe('🖼️ Imagem');
    expect(persistInboundMedia).not.toHaveBeenCalled();
  });

  it('falha no download preserva a legenda que o cliente mandou', async () => {
    vi.mocked(downloadUazapiMedia).mockRejectedValue(new Error('boom'));
    const inbound = inboundImage({ text: 'olha o erro que deu' });

    await materializeInboundMedia(inbound, 'inst-fixo');

    expect(inbound.mediaUrl).toBeNull();
    expect(inbound.text).toBe('olha o erro que deu');
  });

  it('mensagem de texto não dispara download', async () => {
    const inbound = inboundImage({ kind: 'text', mediaUrl: null, text: 'bom dia' });

    await materializeInboundMedia(inbound, 'inst-fixo');

    expect(downloadUazapiMedia).not.toHaveBeenCalled();
    expect(inbound.text).toBe('bom dia');
  });

  it('kind desconhecido não dispara download', async () => {
    const inbound = inboundImage({ kind: 'unknown', mediaUrl: null });

    await materializeInboundMedia(inbound, 'inst-fixo');

    expect(downloadUazapiMedia).not.toHaveBeenCalled();
  });

  it('é idempotente: URL que já é local não rebaixa', async () => {
    const inbound = inboundImage({ mediaUrl: '/uploads/inbound/ja-existe.jpg' });

    await materializeInboundMedia(inbound, 'inst-fixo');

    expect(downloadUazapiMedia).not.toHaveBeenCalled();
    expect(inbound.mediaUrl).toBe('/uploads/inbound/ja-existe.jpg');
  });

  it('sem instanceId cai na linha padrão (compat com instalação de linha única)', async () => {
    await materializeInboundMedia(inboundImage(), undefined);

    expect(loadSendConfig).toHaveBeenCalledWith(undefined);
  });

  it('usa o mime que o provider devolveu no download, não o do payload', async () => {
    // O payload do webhook as vezes traz mime generico; o /message/download
    // devolve o real do arquivo ja decifrado.
    vi.mocked(downloadUazapiMedia).mockResolvedValue({
      buffer: Buffer.from('png-bytes'),
      mime: 'image/png',
    });
    const inbound = inboundImage({ mediaMime: 'application/octet-stream' });

    await materializeInboundMedia(inbound, 'inst-fixo');

    expect(persistInboundMedia).toHaveBeenCalledWith(Buffer.from('png-bytes'), 'image/png');
    expect(inbound.mediaMime).toBe('image/png');
  });
});
