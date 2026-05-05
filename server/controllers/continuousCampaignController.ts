import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  getContinuousCampaign,
  upsertContinuousCampaign,
  isWithinDispatchWindow,
} from '../services/continuousCampaign';

const variantSchema = z.object({
  name: z.string().max(120).optional(),
  body: z.string().min(1).max(4000),
  mediaUrl: z.string().url().nullable().optional(),
  mediaMime: z.string().max(120).nullable().optional(),
});

const upsertBody = z.object({
  name: z.string().min(1).max(120).optional(),
  status: z.enum(['running', 'paused']).optional(),
  messageBody: z.string().max(4000).optional(),
  messageVariants: z.array(variantSchema).max(10).optional(),
  ratePerMinute: z.number().int().min(1).max(120).optional(),
});

export async function getHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const data = await getContinuousCampaign();
    const window = await isWithinDispatchWindow();
    res.json({ campaign: data, dispatchWindow: window });
  } catch (e) { next(e); }
}

export async function upsertHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = upsertBody.parse(req.body);
    const data = await upsertContinuousCampaign(req.user!.userId, body);
    res.json(data);
  } catch (e) { next(e); }
}
