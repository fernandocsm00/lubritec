import type { Request, Response, NextFunction } from 'express';
import { uazapiInboundSchema } from '../lib/uazapiSchema';
import { ingestInbound } from '../services/whatsappWebhookService';

export async function whatsappWebhookHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const expected = process.env.UAZAPI_WEBHOOK_SECRET;
    if (!expected) {
      // Sem secret configurado, tratamos qualquer chamada como inválida.
      return res.status(401).json({ error: 'Webhook secret not configured' });
    }
    const got = req.header('X-Webhook-Token');
    if (got !== expected) {
      return res.status(401).json({ error: 'Invalid webhook token' });
    }

    const parsed = uazapiInboundSchema.safeParse(req.body);
    if (!parsed.success) {
      // Payload inválido — UazAPI não vai conseguir corrigir, então 200 silencioso.
      return res.status(200).end();
    }
    await ingestInbound(parsed.data, req.body);
    return res.status(200).end();
  } catch (e) {
    next(e);
  }
}
