import type { Request, Response, NextFunction } from 'express';
import { uazapiInboundSchema } from '../lib/uazapiSchema';
import { ingestInbound } from '../services/whatsappWebhookService';
import { loadWebhookSecret } from '../services/whatsappInstanceService';

export async function whatsappWebhookHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    // Lê secret ativo: DB > env. Sem nenhum, qualquer chamada é 401.
    const expected = await loadWebhookSecret();
    if (!expected) {
      return res.status(401).json({ error: 'Webhook secret not configured' });
    }
    const got = req.header('X-Webhook-Token');
    if (got !== expected) {
      return res.status(401).json({ error: 'Invalid webhook token' });
    }

    const parsed = uazapiInboundSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(200).end();
    }
    await ingestInbound(parsed.data, req.body);
    return res.status(200).end();
  } catch (e) {
    next(e);
  }
}
