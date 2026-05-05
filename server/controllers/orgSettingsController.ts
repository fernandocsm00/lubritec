import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { getOrgSettings, updateOrgSettings } from '../services/orgSettingsService';

const putBody = z.object({
  monthlySalesGoal: z.number().nonnegative().nullable().optional(),
  aiEnabled: z.boolean().optional(),
  aiAgentName: z.string().min(1).max(120).optional(),
  aiBusinessName: z.string().min(1).max(120).optional(),
  aiBusinessDesc: z.string().max(4000).optional(),
  aiProducts: z.string().max(4000).optional(),
  aiTargetAudience: z.string().max(2000).optional(),
  aiTone: z.string().min(1).max(200).optional(),
  aiObjective: z.string().min(1).max(2000).optional(),
  aiDontTalk: z.string().max(2000).optional(),
  aiAlwaysAsk: z.string().max(2000).optional(),
  aiQualifyWhen: z.string().min(1).max(2000).optional(),
  aiBusinessHours: z.string().max(200).optional(),
  aiAfterHoursMsg: z.string().max(2000).optional(),
  dispatchStartHour: z.number().int().min(0).max(23).optional(),
  dispatchEndHour: z.number().int().min(0).max(24).optional(),
  dispatchSkipWeekends: z.boolean().optional(),
  dispatchTimezone: z.string().min(1).max(64).optional(),
});

export async function getHandler(_req: Request, res: Response, next: NextFunction) {
  try { res.json(await getOrgSettings()); } catch (e) { next(e); }
}

export async function putHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = putBody.parse(req.body);
    res.json(await updateOrgSettings(body));
  } catch (e) { next(e); }
}
