import type { Request, Response, NextFunction } from 'express';
import { eq, or } from 'drizzle-orm';
import { db } from '../db/client';
import { messages } from '../db/schema';
import { uazapiInboundSchema, extractInbound } from '../lib/uazapiSchema';
import { ingestInbound } from '../services/whatsappWebhookService';
import { materializeInboundMedia } from '../services/whatsapp/uazapi/inboundMedia';
import { loadValidWebhookTokens, resolveInstanceIdByWebhookToken } from '../services/whatsappInstanceService';
import { recordDeliveryStatus } from '../services/messageDelivery';
import type { DeliveryStatus } from '@shared/types';
import { scheduleAiReply } from '../services/aiInboundBatch';
import {
  pushDebugEntry,
  summarizeHeaders,
  type WebhookDebugEntry,
} from '../lib/webhookDebugBuffer';

/**
 * Traduz o vocabulario de status da UazAPI (herdado do Baileys) pro nosso
 * DeliveryStatus. 'Deleted' NAO entra aqui — revogacao e outro eixo, tratada
 * separadamente.
 *
 * Vocabulario observado: Pending, ServerAck/Sent, DeliveryAck/Delivered, Read,
 * Played, Error/Failed. Normalizamos removendo tudo que nao e letra porque a
 * mesma instancia ja mandou 'DeliveryAck', 'delivery_ack' e 'DELIVERY-ACK'.
 */
function toDeliveryStatus(rawStatus: string): DeliveryStatus | null {
  const s = rawStatus.toLowerCase().replace(/[^a-z]/g, '');
  if (!s) return null;
  if (s.includes('error') || s.includes('fail')) return 'failed';
  // 'played' e o ACK de audio ouvido — para o remetente equivale a lido.
  if (s.includes('read') || s.includes('played')) return 'read';
  if (s.includes('deliver')) return 'delivered';
  if (s.includes('serverack') || s === 'sent' || s === 'ack') return 'sent';
  if (s.includes('pending')) return 'queued';
  return null;
}

/**
 * UazAPI manda evento 'messages_update' (ou 'messages.update') com o status da
 * mensagem de saida: Pending → ServerAck → DeliveryAck → Read, ou Error quando
 * o envio falha. Tambem manda 'Deleted' quando uma msg eh revogada — seja por
 * nos via POST /message/delete OU pelo proprio cliente apagando pelo celular.
 *
 * Este e o UNICO sinal de entrega real que existe: a resposta do /send devolve
 * `status: "Pending"` sempre, ou seja "entrou na fila", nunca "chegou". Antes da
 * migration 046 tudo que nao fosse 'Deleted' era descartado aqui — por isso
 * mensagem que nunca chegou ao destino ficava indistinguivel de mensagem lida.
 *
 * Retorna null se nao eh evento de update (e o handler segue pro extractInbound).
 *
 * Match pelo provider_msg_id: aceita formato 'owner:messageid' OU so 'messageid'
 * porque o ID que gravamos no send vem nesse formato e o webhook ja vem com
 * messageid puro — entao matchamos por OU.
 *
 * O formato real do recibo nunca foi visto em producao: ate 25/09/2026 o webhook
 * nao assinava messages_update e filtrava wasSentByApi, entao nenhum chegou.
 * `collectAcks` aceita as familias plausiveis; o que nao casar vira
 * ignored_update com o corpo cru no painel de debug, pra ajustar em cima do real.
 */
type UpdateResult =
  | { kind: 'message_deleted'; messageId: string }
  | { kind: 'delivery_status'; messageId: string; status: DeliveryStatus }
  | { kind: 'ignored_update'; reason: string };

async function tryHandleMessageUpdate(
  payload: Record<string, unknown>,
): Promise<UpdateResult | null> {
  const isUpdate = eventName(payload).includes('update');
  if (!isUpdate && !isOwnEchoWithStatus(payload)) return null;

  const acks = collectAcks(payload);
  if (acks.length === 0) return { kind: 'ignored_update', reason: 'missing message id' };

  // Recibo do whatsmeow agrupa varios ids num evento so: aplica a cada um e
  // reporta o primeiro que mudou alguma coisa.
  let result: UpdateResult | null = null;
  for (const ack of acks) {
    const r = await applyAck(ack);
    if (!result || (result.kind === 'ignored_update' && r.kind !== 'ignored_update')) result = r;
  }
  return result;
}

interface Ack {
  id: string;
  status: string;
  /** Objeto de onde tirar codigo/motivo do erro. */
  source: Record<string, unknown>;
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Nome do evento: o primeiro campo TEXTO entre os candidatos. No recibo do
 * whatsmeow `event` e o objeto do recibo, nao o nome — String() dele dava
 * "[object Object]" e o recibo se perdia como "nao e mensagem". */
function eventName(payload: Record<string, unknown>): string {
  for (const k of ['event', 'EventType', 'type', 'eventType']) {
    const v = payload[k];
    if (typeof v === 'string' && v.trim()) return v.toLowerCase();
  }
  return '';
}

/** Eco de mensagem que NOS enviamos, carregando status. extractInbound descarta
 * o eco (fromMe) — sem isto o status que ele traz se perderia junto. */
function isOwnEchoWithStatus(payload: Record<string, unknown>): boolean {
  const msg = asObject(payload.message);
  if (!msg) return false;
  const own = msg.fromMe === true || msg.wasSentByApi === true;
  return own && typeof msg.status === 'string' && msg.status.trim() !== '';
}

// Status numerico do Baileys (proto WebMessageInfo.Status).
const BAILEYS_STATUS = ['error', 'pending', 'serverack', 'deliveryack', 'read', 'played'];

function statusText(v: unknown): string {
  if (typeof v === 'number') return BAILEYS_STATUS[v] ?? '';
  return typeof v === 'string' ? v.toLowerCase() : '';
}

function idOf(obj: Record<string, unknown>): string | null {
  return firstString(obj, ['id', 'messageid', 'messageId']);
}

function collectAcks(payload: Record<string, unknown>): Ack[] {
  // Baileys nativo: [{ key: { id }, update: { status: <numero> } }]
  const list = Array.isArray(payload.data) ? payload.data : null;
  if (list) {
    return list.flatMap((item) => {
      const o = asObject(item);
      if (!o) return [];
      const key = asObject(o.key) ?? o;
      const update = asObject(o.update) ?? o;
      const id = idOf(key);
      return id ? [{ id, status: statusText(update.status), source: update }] : [];
    });
  }

  // whatsmeow: { event: { MessageIDs: [...], Type }, state }
  const ev = asObject(payload.event);
  if (ev && Array.isArray(ev.MessageIDs)) {
    const status = statusText(payload.state) || statusText(ev.State) || statusText(ev.Type);
    return ev.MessageIDs
      .filter((id): id is string => typeof id === 'string' && id.trim() !== '')
      .map((id) => ({ id, status, source: ev }));
  }

  // Objeto normalizado da UazAPI: { message: { id, status } }
  const msgObj = asObject(payload.message) ?? asObject(payload.data) ?? payload;
  const id = idOf(msgObj);
  return id ? [{ id, status: statusText(msgObj.status), source: msgObj }] : [];
}

async function applyAck({ id: msgId, status, source: msgObj }: Ack): Promise<UpdateResult> {
  if (status.includes('delete')) {
    // Match flexivel: provider_msg_id pode estar gravado como 'owner:messageid'
    // (vindo do send response) ou so 'messageid' (vindo do payload de update).
    const suffix = msgId.includes(':') ? msgId.split(':').pop()! : msgId;
    const result = await db
      .update(messages)
      .set({ deletedAt: new Date() })
      .where(
        or(
          eq(messages.providerMsgId, msgId),
          eq(messages.providerMsgId, suffix),
        ),
      )
      .returning({ id: messages.id });

    if (result.length === 0) {
      return { kind: 'ignored_update', reason: `no local message matching ${msgId}` };
    }
    return { kind: 'message_deleted', messageId: result[0].id };
  }

  const delivery = toDeliveryStatus(status);
  if (!delivery) {
    return { kind: 'ignored_update', reason: `status=${status || 'unknown'}` };
  }

  const res = await recordDeliveryStatus({
    provider: 'uazapi',
    providerMsgId: msgId,
    status: delivery,
    errorCode: firstString(msgObj, ['code', 'errorCode', 'statusCode']),
    errorMessage: firstString(msgObj, ['error', 'errorMessage', 'reason', 'description']),
  });

  if (!res.updated) {
    return { kind: 'ignored_update', reason: res.reason ?? 'not applied' };
  }
  return { kind: 'delivery_status', messageId: res.messageId!, status: delivery };
}

/** Primeiro valor string nao-vazio entre as chaves dadas. */
function firstString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v;
    if (typeof v === 'number') return String(v);
  }
  return null;
}

/**
 * Lê o token enviado pela uazapiGO. Aceita múltiplas convenções porque
 * uazapiGO REALMENTE não envia headers de auth — o canônico é via QUERY STRING
 * (`?instanceToken=XXX`), embutido na URL que cadastramos via setWebhook.
 *
 * Fontes (em ordem de prioridade):
 *   1. Query string: `instanceToken`, `token`, `apikey`
 *   2. Headers: `X-Webhook-Token`, `token`, `apikey`
 *   3. Authorization: Bearer
 *   4. Body: `token`, `apikey`, `webhookToken`, `secret`
 */
function extractIncomingToken(req: Request): string | null {
  // 1. Query string (canônico para uazapiGO)
  const q = req.query as Record<string, unknown>;
  for (const k of ['instanceToken', 'token', 'apikey']) {
    const v = q[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }

  // 2. Headers
  const h = (name: string) => {
    const v = req.header(name);
    return typeof v === 'string' && v.length > 0 ? v : null;
  };
  const fromHeader =
    h('X-Webhook-Token') ??
    h('x-webhook-token') ??
    h('token') ??
    h('apikey');
  if (fromHeader) return fromHeader;

  // 3. Authorization
  const auth = h('Authorization') ?? h('authorization');
  if (auth) {
    const m = /^Bearer\s+(.+)$/i.exec(auth);
    if (m) return m[1];
    return auth;
  }

  // 4. Body
  const body = req.body as Record<string, unknown> | undefined;
  if (body && typeof body === 'object') {
    for (const k of ['token', 'apikey', 'webhookToken', 'secret']) {
      const v = body[k];
      if (typeof v === 'string' && v.length > 0) return v;
    }
  }
  return null;
}

export async function whatsappWebhookHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const debug: WebhookDebugEntry = {
    receivedAt: new Date().toISOString(),
    headers: summarizeHeaders(req.headers as Record<string, unknown>),
    body: req.body,
    bodyKeys: req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? Object.keys(req.body)
      : null,
    result: { kind: 'error', message: 'unhandled' },
  };

  // Diagnóstico: SEMPRE logamos o payload bruto antes de qualquer validação.
  try {
    console.log('[whatsapp:webhook] received', {
      headers: debug.headers,
      bodyKeys: debug.bodyKeys,
      body: debug.body,
    });
  } catch {
    // Logging não pode derrubar o handler.
  }

  try {
    const validTokens = await loadValidWebhookTokens();
    if (validTokens.length === 0) {
      debug.result = { kind: 'no_secret_configured' };
      pushDebugEntry(debug);
      return res.status(401).json({ error: 'Webhook secret not configured' });
    }

    const got = extractIncomingToken(req);
    if (!got || !validTokens.includes(got)) {
      console.warn('[whatsapp:webhook] auth failed', {
        gotPresent: !!got,
        gotLen: got?.length ?? 0,
        acceptedCount: validTokens.length,
      });
      debug.result = {
        kind: 'auth_failed',
        reason: got
          ? `provided token (${got.length} chars) does not match any of the ${validTokens.length} accepted tokens`
          : 'no token in headers/body',
      };
      pushDebugEntry(debug);
      return res.status(401).json({ error: 'Invalid webhook token' });
    }

    const parsed = uazapiInboundSchema.safeParse(req.body);
    if (!parsed.success) {
      console.warn('[whatsapp:webhook] non-object body, ignoring');
      debug.result = { kind: 'non_object_body' };
      pushDebugEntry(debug);
      return res.status(200).end();
    }

    // Antes de tratar como mensagem nova: detecta messages_update com status
    // Deleted (uazapi /message/delete OU cliente apagou pelo celular dele).
    // Marca deleted_at na linha local correspondente pra UI refletir.
    const updateResult = await tryHandleMessageUpdate(parsed.data);
    if (updateResult) {
      debug.result = updateResult;
      pushDebugEntry(debug);
      return res.status(200).end();
    }

    const inbound = extractInbound(parsed.data);
    if (!inbound) {
      debug.result = {
        kind: 'not_a_message',
        reason: 'event not recognized as inbound message OR missing id/from OR fromMe=true',
      };
      pushDebugEntry(debug);
      return res.status(200).end();
    }

    debug.result = {
      kind: 'extracted',
      messageId: inbound.id,
      from: inbound.from,
      messageKind: inbound.kind,
      fromMe: inbound.fromMe,
    };

    // Roteia pra instância dona do token (multi-linha). `got` já foi validado
    // acima. Se não mapear (ex.: token do env), ingestInbound cai na padrão.
    const routedInstanceId = (await resolveInstanceIdByWebhookToken(got)) ?? undefined;

    // Baixa a mídia ANTES de gravar: o webhook entrega URL da CDN do WhatsApp
    // com conteúdo cifrado, que o <img> do frontend não renderiza. Troca pela
    // URL local. Síncrono de propósito — a mensagem entra no banco já completa,
    // e o insert é idempotente (unique em provider_msg_id), então um retry da
    // UazAPI por timeout não duplica. Nunca lança: falha vira bolha com label.
    await materializeInboundMedia(inbound, routedInstanceId);

    const ingestResult = await ingestInbound(inbound, parsed.data, routedInstanceId);
    debug.result = { kind: ingestResult.status, messageId: inbound.id };
    pushDebugEntry(debug);

    // Agenda a resposta da IA: ela espera o cliente parar de digitar e responde
    // o lote de uma vez (aiInboundBatch) — responder cada pedaço na hora dava
    // uma resposta por mensagem. Não trava a resposta pra UazAPI (timeout curto,
    // retry agressivo). Só texto recém-inserido; IA desligada ou conversa fora
    // da fila IA viram no-op lá na frente.
    if (
      ingestResult.status === 'inserted' &&
      ingestResult.conversationId &&
      ingestResult.leadId &&
      inbound.kind === 'text' &&
      inbound.text
    ) {
      scheduleAiReply({
        conversationId: ingestResult.conversationId,
        leadId: ingestResult.leadId,
        phone: inbound.from.replace(/\D/g, ''),
      });
    }

    return res.status(200).end();
  } catch (e) {
    debug.result = { kind: 'error', message: e instanceof Error ? e.message : String(e) };
    pushDebugEntry(debug);
    next(e);
  }
}
