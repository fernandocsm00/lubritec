import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  listNotifications,
  unreadCountFor,
  markRead,
  markAllRead,
} from '../services/notifications';

const idParams = z.object({ id: z.string().uuid() });

export async function listHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await listNotifications(req.user!.userId));
  } catch (e) { next(e); }
}

export async function unreadCountHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const count = await unreadCountFor(req.user!.userId);
    res.json({ unreadCount: count });
  } catch (e) { next(e); }
}

export async function markReadHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    await markRead(req.user!.userId, id);
    res.status(204).end();
  } catch (e) { next(e); }
}

export async function markAllReadHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const r = await markAllRead(req.user!.userId);
    res.json(r);
  } catch (e) { next(e); }
}
