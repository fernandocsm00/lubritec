import { Router, type Request, type Response } from 'express';
import {
  loadMetaInstance,
  verifyHmac,
  processMetaWebhook,
  markWebhookSubscribed,
  type MetaWebhookBody,
} from '../services/whatsapp/metaCloud/webhookHandler';
import { decryptSecret } from '../lib/crypto';
import {
  pushDebugEntry,
  summarizeHeaders,
  type WebhookDebugEntry,
} from '../lib/webhookDebugBuffer';

const router = Router();

function bodyKeysOf(body: unknown): string[] | null {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? Object.keys(body as Record<string, unknown>) : null;
}

function countMetaPayload(body: MetaWebhookBody | unknown): {
  entries: number; messages: number; statuses: number; templateUpdates: number;
} {
  const out = { entries: 0, messages: 0, statuses: 0, templateUpdates: 0 };
  const b = body as MetaWebhookBody | undefined;
  if (!b || !Array.isArray(b.entry)) return out;
  out.entries = b.entry.length;
  for (const entry of b.entry) {
    for (const change of entry.changes ?? []) {
      if (change.field === 'messages') {
        out.messages += change.value?.messages?.length ?? 0;
        out.statuses += change.value?.statuses?.length ?? 0;
      } else if (change.field === 'message_template_status_update') {
        out.templateUpdates += 1;
      }
    }
  }
  return out;
}

router.get('/:instanceId', async (req: Request, res: Response) => {
  const { instanceId } = req.params;
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const debug: WebhookDebugEntry = {
    receivedAt: new Date().toISOString(),
    provider: 'meta_cloud',
    method: 'GET',
    instanceId,
    headers: summarizeHeaders(req.headers as Record<string, unknown>),
    body: { mode, token: typeof token === 'string' && token.length > 8 ? `${token.slice(0, 6)}…(${token.length} chars)` : token, challenge },
    bodyKeys: null,
    result: { kind: 'meta_verify_ok' },
  };

  const inst = await loadMetaInstance(instanceId);
  if (!inst) {
    debug.result = { kind: 'meta_instance_not_found' };
    pushDebugEntry(debug);
    return res.sendStatus(404);
  }

  if (mode === 'subscribe' && token === inst.cfg.webhookVerifyToken) {
    await markWebhookSubscribed(instanceId).catch(() => { /* best-effort */ });
    debug.result = { kind: 'meta_verify_ok' };
    pushDebugEntry(debug);
    return res.status(200).send(typeof challenge === 'string' ? challenge : '');
  }
  debug.result = {
    kind: 'meta_verify_failed',
    reason: mode !== 'subscribe' ? `hub.mode='${String(mode)}' (expected 'subscribe')` : 'hub.verify_token mismatch',
  };
  pushDebugEntry(debug);
  return res.sendStatus(403);
});

router.post('/:instanceId', async (req: Request, res: Response) => {
  const { instanceId } = req.params;
  const debug: WebhookDebugEntry = {
    receivedAt: new Date().toISOString(),
    provider: 'meta_cloud',
    method: 'POST',
    instanceId,
    headers: summarizeHeaders(req.headers as Record<string, unknown>),
    body: req.body,
    bodyKeys: bodyKeysOf(req.body),
    result: { kind: 'meta_accepted', entries: 0, messages: 0, statuses: 0, templateUpdates: 0 },
  };

  const inst = await loadMetaInstance(instanceId);
  if (!inst) {
    debug.result = { kind: 'meta_instance_not_found' };
    pushDebugEntry(debug);
    return res.sendStatus(404);
  }

  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBody) {
    console.error('[meta-webhook] rawBody not preserved — middleware misconfigured');
    debug.result = { kind: 'meta_no_raw_body' };
    pushDebugEntry(debug);
    return res.sendStatus(500);
  }
  const sigHeader = req.headers['x-hub-signature-256'] as string | undefined;
  const appSecret = decryptSecret(inst.cfg.appSecret);
  if (!verifyHmac(rawBody, sigHeader, appSecret)) {
    debug.result = { kind: 'meta_hmac_failed' };
    pushDebugEntry(debug);
    return res.sendStatus(401);
  }

  debug.result = { kind: 'meta_accepted', ...countMetaPayload(req.body) };
  pushDebugEntry(debug);

  // Ack Meta IMMEDIATELY (they don't retry generously on slow handlers)
  res.sendStatus(200);

  // Process async
  processMetaWebhook(instanceId, inst.cfg, req.body)
    .catch((err) => console.error('[meta-webhook] processing failed:', err));
});

export default router;
