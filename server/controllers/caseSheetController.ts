import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import { getCaseSheet, requestReanalysis } from '../services/caseSheetService';

export async function getHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const sheet = await getCaseSheet(req.params.leadId);
    res.json(sheet);
  } catch (e) { next(e); }
}

const reanalyzeBody = z.object({
  reason: z.string().trim().min(3).max(500),
});

export async function reanalyzeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    // Admin check eh feito pelo middleware requireRole('admin') na route.
    const data = reanalyzeBody.parse(req.body);
    await requestReanalysis({
      leadId: req.params.leadId,
      adminUserId: req.user!.userId,
      reason: data.reason,
    });
    res.status(202).send();
  } catch (e) { next(e); }
}
