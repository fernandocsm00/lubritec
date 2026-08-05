import type { MessageKind } from '@shared/types';
import { fallbackBodyFor, type InboundMessage } from '../../../lib/uazapiSchema';
import { loadSendConfig } from '../../whatsappInstanceService';
import { persistInboundMedia } from '../inboundMediaStore';
import { downloadUazapiMedia } from './client';

/**
 * Materializa a midia de uma mensagem inbound da UazAPI: baixa o arquivo
 * decifrado e troca `inbound.mediaUrl` pela URL local (/uploads/inbound/...).
 *
 * CONTEXTO — o bug que isso conserta: o webhook da UazAPI entrega a URL crua da
 * CDN do WhatsApp (mmg.whatsapp.net), cujo conteudo e cifrado com o mediaKey da
 * mensagem. Gravar essa URL direto em messages.media_url fazia TODA midia
 * recebida pela linha UazAPI aparecer como imagem quebrada na inbox. O caminho
 * do Meta Cloud ja fazia baixar-e-persistir (metaCloud/webhookHandler.ts); aqui
 * e o equivalente pro outro provider.
 *
 * Muta o `inbound` no lugar — ele e um DTO de passagem entre extractInbound() e
 * ingestInbound(), e o controller so precisa chamar isso no meio.
 *
 * NUNCA propaga erro: midia quebrada nao pode derrubar o ingest da mensagem. Se
 * o download falha, zera a mediaUrl (melhor bolha com label do que <img>
 * quebrado) e o raw_payload guarda tudo pra um eventual reprocessamento.
 */
const MEDIA_KINDS: ReadonlySet<MessageKind> = new Set(['image', 'audio', 'video', 'document']);

export async function materializeInboundMedia(
  inbound: InboundMessage,
  instanceId?: string,
): Promise<void> {
  if (!MEDIA_KINDS.has(inbound.kind)) return;
  // Idempotente: se ja e local, nao rebaixa (protege reprocessamento/retry).
  if (inbound.mediaUrl?.startsWith('/uploads/')) return;

  const fallback = fallbackBodyFor(inbound.kind, inbound.isSticker);

  try {
    // Config DA LINHA da conversa (multi-instancia). Sem instanceId cai na
    // padrao — compat com instalacao de linha unica.
    const cfg = await loadSendConfig(instanceId);
    const { buffer, mime } = await downloadUazapiMedia(inbound.id, {
      baseUrl: cfg.baseUrl,
      token: cfg.token,
    });

    // O mime do download vem do arquivo ja decifrado — mais confiavel que o do
    // payload do webhook, que as vezes vem generico.
    const resolvedMime = mime ?? inbound.mediaMime;
    inbound.mediaUrl = await persistInboundMedia(buffer, resolvedMime);
    inbound.mediaMime = resolvedMime;

    // extractInbound poe o label fallback no body quando nao ha URL renderizavel
    // (caso tipico: figurinha, que vem com URL placeholder). Agora que a imagem
    // real esta na bolha, o label vira ruido — some. Legenda do cliente fica.
    if (inbound.text === fallback) inbound.text = null;
  } catch (err) {
    console.warn('[uazapi:webhook] failed to download/persist inbound media:', err);
    inbound.mediaUrl = null;
    if (!inbound.text?.trim()) inbound.text = fallback;
  }
}
