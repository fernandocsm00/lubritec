import type { Request, Response, NextFunction } from 'express';
import { uazapiInboundSchema, extractInbound } from '../lib/uazapiSchema';
import { ingestInbound } from '../services/whatsappWebhookService';
import { loadValidWebhookTokens } from '../services/whatsappInstanceService';
import {
  pushDebugEntry,
  summarizeHeaders,
  type WebhookDebugEntry,
} from '../lib/webhookDebugBuffer';

/**
 * Lê o secret enviado pela uazapiGO. Aceita várias convenções porque a
 * uazapiGO em diferentes versões usa headers/campos diferentes:
 *   - Header `X-Webhook-Token` (formato canônico que registramos)
 *   - Header `token` (uazapiGO instance token na maioria das versões)
 *   - Header `Authorization: Bearer <token>`
 *   - Body `token` / `apikey` / `webhookToken`
 */
function extractIncomingToken(req: Request): string | null {
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

  const auth = h('Authorization') ?? h('authorization');
  if (auth) {
    const m = /^Bearer\s+(.+)$/i.exec(auth);
    if (m) return m[1];
    return auth;
  }

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

    return res.status(200).end();
  } catch (e) {
    debug.result = { kind: 'error', message: e instanceof Error ? e.message : String(e) };
    pushDebugEntry(debug);
    next(e);
  }
}
