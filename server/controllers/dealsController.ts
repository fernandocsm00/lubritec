import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { DEAL_STAGES, LOSS_REASONS, LEAD_QUALITY_FEEDBACK } from '../../shared/types';
import {
  listBoard,
  listHistory,
  getDealById,
} from '../services/dealsService';

const idParams = z.object({ id: z.string().uuid() });

const ownerFilter = z.union([
  z.enum(['mine', 'all', 'unassigned']),
  z.string().uuid(),
]);

const boardQuery = z.object({
  owner: ownerFilter.optional(),
  q: z.string().optional(),
});

const historyQuery = z.object({
  owner: ownerFilter.optional(),
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

import {
  createDeal,
  updateDeal,
  changeStage,
  deleteDeal,
} from '../services/dealsService';

const createBody = z.object({
  leadId: z.string().uuid(),
  proposalValue: z.number().nonnegative().optional(),
});

const patchBody = z
  .object({
    proposalValue: z.number().nonnegative().nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    ownerUserId: z.string().uuid().nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'At least one field required' });

const stageBody = z.object({
  stage: z.enum(DEAL_STAGES),
  lossReason: z.enum(LOSS_REASONS).optional(),
  leadQualityFeedback: z.enum(LEAD_QUALITY_FEEDBACK).optional(),
});

export async function createHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createBody.parse(req.body);
    const deal = await createDeal({
      leadId: data.leadId,
      proposalValue: data.proposalValue ?? null,
      ownerUserId: req.user!.userId,
      source: 'manual',
    });
    res.json(deal);
  } catch (e) { next(e); }
}

export async function patchHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    const data = patchBody.parse(req.body);
    const deal = await updateDeal({
      id,
      actorUserId: req.user!.userId,
      proposalValue: data.proposalValue,
      notes: data.notes,
      ownerUserId: data.ownerUserId,
    });
    res.json(deal);
  } catch (e) { next(e); }
}

export async function stageHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    const data = stageBody.parse(req.body);
    const deal = await changeStage({
      id,
      actorUserId: req.user!.userId,
      stage: data.stage,
      lossReason: data.lossReason,
      leadQualityFeedback: data.leadQualityFeedback,
    });
    res.json(deal);
  } catch (e) { next(e); }
}

export async function deleteHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    await deleteDeal(id);
    res.status(204).end();
  } catch (e) { next(e); }
}
