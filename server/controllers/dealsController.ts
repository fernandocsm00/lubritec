import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { DEAL_STAGES, LOSS_REASONS } from '../../shared/types';
import {
  listBoard,
  listHistory,
  getDealById,
} from '../services/dealsService';

const idParams = z.object({ id: z.string().uuid() });

const boardQuery = z.object({
  owner: z.enum(['mine', 'all']).optional(),
  q: z.string().optional(),
});

const historyQuery = z.object({
  owner: z.enum(['mine', 'all']).optional(),
  q: z.string().optional(),
  stage: z.enum(['ganho', 'perdido']).optional(),
  lossReason: z.enum(LOSS_REASONS).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).max(100000).optional(),
});

export async function boardHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const params = boardQuery.parse(req.query);
    const result = await listBoard({
      ownerFilter: params.owner ?? 'mine',
      q: params.q,
      currentUserId: req.user!.userId,
    });
    res.json(result);
  } catch (e) { next(e); }
}

export async function historyHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const params = historyQuery.parse(req.query);
    const result = await listHistory({
      ownerFilter: params.owner ?? 'all',
      q: params.q,
      stage: params.stage,
      lossReason: params.lossReason,
      from: params.from ? new Date(params.from) : undefined,
      to: params.to ? new Date(params.to) : undefined,
      page: params.page,
      currentUserId: req.user!.userId,
    });
    res.json(result);
  } catch (e) { next(e); }
}

export async function getHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    res.json(await getDealById(id));
  } catch (e) { next(e); }
}

// Re-exports usados na tarefa 6
export { DEAL_STAGES, LOSS_REASONS };
