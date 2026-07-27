import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { HSM_CATEGORIES } from '@shared/types';
import * as svc from '../services/hsmTemplateService';
import { HttpError } from '../middleware/errorHandler';

const createSchema = z.object({
  name: z.string().min(1).regex(/^[a-z0-9_]+$/, 'name must be snake_case'),
  language: z.string().min(2),
  category: z.enum(HSM_CATEGORIES),
  components: z.array(z.any()).min(1, 'at least one component (BODY) is required'),
  headerMediaUrl: z.string().url().nullable().optional(),
  submitNow: z.boolean().optional().default(false),
});

export async function listHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const items = await svc.listTemplates(req.params.instanceId);
    res.json({ items });
  } catch (e) { next(e); }
}

export async function createHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = createSchema.parse(req.body);
    const userId = req.user?.userId;
    if (!userId) throw new HttpError(401, 'unauthenticated');
    const row = await svc.createTemplate({
      instanceId: req.params.instanceId,
      createdBy: userId,
      ...body,
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof z.ZodError) return next(new HttpError(422, e.issues[0].message));
    next(e);
  }
}

const updateSchema = z.object({
  name: z.string().min(1).regex(/^[a-z0-9_]+$/, 'name must be snake_case'),
  language: z.string().min(2),
  category: z.enum(HSM_CATEGORIES),
  components: z.array(z.any()).min(1, 'at least one component (BODY) is required'),
  headerMediaUrl: z.string().url().nullable().optional(),
  submitNow: z.boolean().optional().default(false),
});

export async function updateHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = updateSchema.parse(req.body);
    const row = await svc.updateTemplate({
      instanceId: req.params.instanceId,
      templateId: req.params.tid,
      ...body,
    });
    res.json(row);
  } catch (e) {
    if (e instanceof z.ZodError) return next(new HttpError(422, e.issues[0].message));
    next(e);
  }
}

export async function uploadHeaderMediaHandler(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) throw new HttpError(400, 'Nenhuma imagem enviada (campo "file").');
    const result = await svc.uploadHeaderMedia({
      instanceId: req.params.instanceId,
      buffer: req.file.buffer,
    });
    res.json(result);
  } catch (e) { next(e); }
}

export async function deleteHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await svc.deleteTemplate(req.params.instanceId, req.params.tid);
    res.sendStatus(204);
  } catch (e) { next(e); }
}

export async function syncHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await svc.syncTemplates(req.params.id);
    res.json(result);
  } catch (e) { next(e); }
}
