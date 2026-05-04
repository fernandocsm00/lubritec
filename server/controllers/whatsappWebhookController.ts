import type { Request, Response, NextFunction } from 'express';
import { uazapiInboundSchema, extractInbound } from '../lib/uazapiSchema';
import { ingestInbound } from '../services/whatsappWebhookService';
import { loadWebhookSecret } from '../services/whatsappInstanceService';

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
  // Diagnóstico: SEMPRE logamos o payload bruto antes de qualquer validação.
  // Isso permite inspecionar o que a uazapiGO realmente envia (formato varia
  // por versão) sem precisar instrumentar a cada nova falha.
  try {
    const headerKeys = Object.keys(req.headers).filter((k) =>
      ['x-webhook-token', 'token', 'apikey', 'authorization', 'content-type', 'user-agent'].includes(k.toLowerCase()),
    );
    const headerSummary = Object.fromEntries(
      headerKeys.map((k) => [k, k.toLowerCase() === 'authorization' ? '[redacted]' : req.headers[k]]),
    );
    console.log('[whatsapp:webhook] received', {
      headers: headerSummary,
      bodyKeys: req.body && typeof req.body === 'object' ? Object.keys(req.body) : null,
      body: req.body,
    });
  } catch {
    // Logging não pode derrubar o handler.
  }

  try {
    const expected = await loadWebhookSecret();
    if (!expected) {
      // Sem secret configurado: 401 (não dá pra confiar em payload anônimo).
      return res.status(401).json({ error: 'Webhook secret not configured' });
    }

    const got = extractIncomingToken(req);
    if (got !== expected) {
      console.warn('[whatsapp:webhook] auth failed', {
        gotPresent: !!got,
        gotLen: got?.length ?? 0,
      });
      return res.status(401).json({ error: 'Invalid webhook token' });
    }

    const parsed = uazapiInboundSchema.safeParse(req.body);
    if (!parsed.success) {
      // Body não é objeto JSON — já respondemos 200 pra evitar retry agressivo.
      console.warn('[whatsapp:webhook] non-object body, ignoring');
      return res.status(200).end();
    }

    const inbound = extractInbound(parsed.data);
    if (!inbound) {
      // Evento não é de mensagem inbound, ou faltam campos essenciais.
      // Retornamos 200 — uazapiGO entrega vários eventos no mesmo webhook.
      return res.status(200).end();
    }

    await ingestInbound(inbound, parsed.data);
    return res.status(200).end();
  } catch (e) {
    next(e);
  }
}
