import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  getStatus,
  connect,
  disconnect,
  destroy,
  probeWebhook,
} from '../services/whatsappInstanceService';
import { listDebugEntries, clearDebugEntries } from '../lib/webhookDebugBuffer';

const connectBody = z.object({
  baseUrl: z.string().url().optional(),
  instanceToken: z.string().min(1).optional(),
}).passthrough();

export async function statusHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await getStatus());
  } catch (e) { next(e); }
}

export async function connectHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = connectBody.parse(req.body ?? {});
    res.json(await connect({ baseUrl: data.baseUrl, instanceToken: data.instanceToken }));
  } catch (e) { next(e); }
}

export async function disconnectHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await disconnect());
  } catch (e) { next(e); }
}

export async function deleteHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    await destroy();
    res.status(204).end();
  } catch (e) { next(e); }
}

export async function debugEventsHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ events: listDebugEntries() });
  } catch (e) { next(e); }
}

export async function clearDebugEventsHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    clearDebugEntries();
    res.status(204).end();
  } catch (e) { next(e); }
}

export async function probeWebhookHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await probeWebhook());
  } catch (e) { next(e); }
}
