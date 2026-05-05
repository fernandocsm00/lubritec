import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { CAMPAIGN_STATUSES, LEAD_STATUSES, LEAD_SOURCES } from '../../shared/types';
import {
  listCampaigns,
  getCampaignById,
  createCampaign,
  dispatchCampaign,
  pauseCampaign,
  resumeCampaign,
  cancelCampaign,
  deleteCampaign,
  listRecipients,
  getCampaignFunnel,
} from '../services/campaignsService';
import { dryRun } from '../services/campaignsAudience';

const idParams = z.object({ id: z.string().uuid() });

const audienceFilterSchema = z.object({
  status: z.array(z.enum(LEAD_STATUSES)).optional(),
  source: z.array(z.enum(LEAD_SOURCES)).optional(),
  daysSinceCreated: z.number().int().min(0).max(3650).optional(),
  excludeLeadIds: z.array(z.string().uuid()).optional(),
  phoneCsv: z.array(z.string().min(8).max(20)).optional(),
});

const listQuery = z.object({
  q: z.string().optional(),
  status: z.enum(CAMPAIGN_STATUSES).optional(),
  page: z.coerce.number().int().min(1).max(100000).optional(),
});

const createBody = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  templateId: z.string().uuid().nullable().optional(),
  messageBody: z.string().min(1).max(4000),
  mediaUrl: z.string().nullable().optional(),
  mediaMime: z.string().max(60).nullable().optional(),
  audienceFilter: audienceFilterSchema,
  scheduledAt: z.string().datetime().nullable().optional(),
  ratePerMinute: z.number().int().min(1).max(120).optional(),
});

const recipientsQuery = z.object({
  status: z.enum(['pending', 'sent', 'failed', 'skipped']).optional(),
  page: z.coerce.number().int().min(1).max(100000).optional(),
});

export async function listHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const params = listQuery.parse(req.query);
    res.json(await listCampaigns(params));
  } catch (e) { next(e); }
}

export async function getHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    const campaign = await getCampaignById(id);
    const funnel = await getCampaignFunnel(id);
    res.json({ ...campaign, funnel });
  } catch (e) { next(e); }
}

export async function dryRunHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const filters = audienceFilterSchema.parse(req.body);
    res.json(await dryRun(filters));
  } catch (e) { next(e); }
}

export async function createHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createBody.parse(req.body);
    const created = await createCampaign({
      name: data.name,
      description: data.description ?? null,
      templateId: data.templateId ?? null,
      messageBody: data.messageBody,
      mediaUrl: data.mediaUrl ?? null,
      mediaMime: data.mediaMime ?? null,
      audienceFilter: data.audienceFilter,
      scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
      ratePerMinute: data.ratePerMinute,
      createdByUserId: req.user!.userId,
    });
    res.json(created);
  } catch (e) { next(e); }
}

export async function dispatchHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    res.json(await dispatchCampaign(id));
  } catch (e) { next(e); }
}

export async function pauseHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    res.json(await pauseCampaign(id));
  } catch (e) { next(e); }
}

export async function resumeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    res.json(await resumeCampaign(id));
  } catch (e) { next(e); }
}

export async function cancelHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    res.json(await cancelCampaign(id));
  } catch (e) { next(e); }
}

export async function deleteHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    await deleteCampaign(id);
    res.status(204).end();
  } catch (e) { next(e); }
}

export async function recipientsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    const params = recipientsQuery.parse(req.query);
    res.json(await listRecipients({ campaignId: id, ...params }));
  } catch (e) { next(e); }
}

export async function uploadMediaHandler(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Invalid or missing file' });
    }
    const filename = req.file.filename;
    res.json({
      mediaUrl: `/uploads/campaigns/${filename}`,
      mediaMime: req.file.mimetype,
    });
  } catch (e) { next(e); }
}
