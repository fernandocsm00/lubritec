import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  getStatus,
  connect,
  disconnect,
  destroy,
} from '../services/whatsappInstanceService';

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
