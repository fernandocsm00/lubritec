import type { Request, Response, NextFunction } from 'express';
import { uazapiInboundSchema, extractInbound } from '../lib/uazapiSchema';
import { ingestInbound } from '../services/whatsappWebhookService';
import { loadValidWebhookTokens } from '../services/whatsappInstanceService';
import { processInboundWithAi } from '../services/aiAtendimento';
import {
  pushDebugEntry,
  summarizeHeaders,
  type WebhookDebugEntry,
} from '../lib/webhookDebugBuffer';

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

    const ingestResult = await ingestInbound(inbound, parsed.data);
    debug.result = { kind: ingestResult.status, messageId: inbound.id };
    pushDebugEntry(debug);

    // Dispara IA de atendimento em background (fire-and-forget) — não trava
    // a resposta pra UazAPI (que tem timeout curto e retry agressivo).
    // Só pra mensagens de TEXTO com kind=text recém inseridas. Se a IA estiver
    // desligada ou conversa não estiver na fila IA, o orchestrator faz no-op.
    if (
      ingestResult.status === 'inserted' &&
      ingestResult.conversationId &&
      ingestResult.leadId &&
      inbound.kind === 'text' &&
      inbound.text
    ) {
      const convId = ingestResult.conversationId;
      const leadId = ingestResult.leadId;
      const phone = inbound.from.replace(/\D/g, '');
      const text = inbound.text;
      // Não await: roda em background, log de erros via console.
      processInboundWithAi({ conversationId: convId, leadId, phone, inboundText: text })
        .then((r) => {
          if (r.status === 'gemini_error' || r.status === 'send_error') {
            console.error('[ai] processInbound failed:', r.status, r.errorMessage);
          } else {
            console.log('[ai] processInbound:', r.status);
          }
        })
        .catch((err) => {
          console.error('[ai] processInbound threw:', err);
        });
    }

    return res.status(200).end();
  } catch (e) {
    debug.result = { kind: 'error', message: e instanceof Error ? e.message : String(e) };
    pushDebugEntry(debug);
    next(e);
  }
}
