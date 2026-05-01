import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  CONVERSATION_QUEUES,
  CONVERSATION_STATUSES,
  ORIGIN_KINDS,
} from '../../shared/types';
import {
  listConversations,
  getConversationCounts,
  getConversationById,
} from '../services/conversationsService';

const csvOf = <T extends string>(values: readonly T[]) =>
  z
    .string()
    .transform((s) => s.split(',').map((p) => p.trim()).filter(Boolean))
    .pipe(z.array(z.enum(values as readonly [T, ...T[]])).min(1));

const listQuery = z.object({
  queue: z.enum(CONVERSATION_QUEUES).optional(),
  status: csvOf(CONVERSATION_STATUSES).optional(),
  expired24h: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  noResponse: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  origin: csvOf(ORIGIN_KINDS).optional(),
  campaignId: z.string().uuid().optional(),
  assignment: z.enum(['mine', 'unassigned', 'all']).optional(),
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).max(100000).optional(),
});

const idParams = z.object({ id: z.string().uuid() });

export async function listHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const params = listQuery.parse(req.query);
    const result = await listConversations({
      ...params,
      currentUserId: req.user!.userId,
    });
    res.json(result);
  } catch (e) { next(e); }
}

export async function countsHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await getConversationCounts());
  } catch (e) { next(e); }
}

export async function getHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    res.json(await getConversationById(id, req.user!.userId));
  } catch (e) { next(e); }
}
