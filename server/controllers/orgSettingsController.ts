import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { getOrgSettings, updateOrgSettings } from '../services/orgSettingsService';

const putBody = z.object({
  monthlySalesGoal: z.number().nonnegative().nullable(),
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
