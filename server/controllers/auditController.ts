import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import { LEAD_QUALITY_FEEDBACK, AUDIT_SAMPLE_STATUSES } from '@shared/types';
import { listSamples, claimNextSample, recordOutcome } from '../services/auditSampleService';

const listQuery = z.object({
  campaignId: z.string().uuid().optional(),
  status: z.enum(AUDIT_SAMPLE_STATUSES).optional(),
  mineOnly: z.coerce.boolean().optional(),
});

export async function listHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const q = listQuery.parse(req.query);
    const items = await listSamples({
      campaignId: q.campaignId,
      status: q.status,
      assignedToMe: q.mineOnly ? req.user!.userId : undefined,
    });
    res.json({ items });
  } catch (e) { next(e); }
}

const claimBody = z.object({
  campaignId: z.string().uuid().optional(),
});

export async function claimHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const q = claimBody.parse(req.body);
    const claimed = await claimNextSample({ userId: req.user!.userId, campaignId: q.campaignId });
    if (!claimed) return res.status(204).send();
    res.json(claimed);
  } catch (e) { next(e); }
}

const outcomeBody = z.object({
  outcome: z.enum(LEAD_QUALITY_FEEDBACK),
  notes: z.string().trim().max(500).optional(),
});

export async function outcomeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const data = outcomeBody.parse(req.body);
    const updated = await recordOutcome({
      id, userId: req.user!.userId, outcome: data.outcome, notes: data.notes,
    });
    res.json(updated);
  } catch (e) { next(e); }
}
