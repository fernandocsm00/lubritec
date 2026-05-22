import { Router, type Request, type Response } from 'express';
import {
  loadMetaInstance,
  verifyHmac,
  processMetaWebhook,
  markWebhookSubscribed,
} from '../services/whatsapp/metaCloud/webhookHandler';
import { decryptSecret } from '../lib/crypto';

const router = Router();

router.get('/:instanceId', async (req: Request, res: Response) => {
  const { instanceId } = req.params;
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const inst = await loadMetaInstance(instanceId);
  if (!inst) return res.sendStatus(404);

  if (mode === 'subscribe' && token === inst.cfg.webhookVerifyToken) {
    await markWebhookSubscribed(instanceId).catch(() => { /* best-effort */ });
    return res.status(200).send(typeof challenge === 'string' ? challenge : '');
  }
  return res.sendStatus(403);
});

router.post('/:instanceId', async (req: Request, res: Response) => {
  const { instanceId } = req.params;
  const inst = await loadMetaInstance(instanceId);
  if (!inst) return res.sendStatus(404);

  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBody) {
    console.error('[meta-webhook] rawBody not preserved — middleware misconfigured');
    return res.sendStatus(500);
  }
  const sigHeader = req.headers['x-hub-signature-256'] as string | undefined;
  const appSecret = decryptSecret(inst.cfg.appSecret);
  if (!verifyHmac(rawBody, sigHeader, appSecret)) {
    return res.sendStatus(401);
  }

  // Ack Meta IMMEDIATELY (they don't retry generously on slow handlers)
  res.sendStatus(200);

  // Process async
  processMetaWebhook(instanceId, inst.cfg, req.body)
    .catch((err) => console.error('[meta-webhook] processing failed:', err));
});

export default router;
