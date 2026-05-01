import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
} from '../services/messageTemplatesService';

const idParams = z.object({ id: z.string().uuid() });

const createBody = z.object({
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(4000),
});

const updateBody = z
  .object({
    title: z.string().min(1).max(120).optional(),
    body: z.string().min(1).max(4000).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'At least one field required' });

export async function listHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await listTemplates());
  } catch (e) { next(e); }
}

export async function createHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createBody.parse(req.body);
    res.json(await createTemplate({ ...data, userId: req.user!.userId }));
  } catch (e) { next(e); }
}

export async function updateHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    const data = updateBody.parse(req.body);
    res.json(await updateTemplate({ id, ...data }));
  } catch (e) { next(e); }
}

export async function deleteHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    await deleteTemplate(id);
    res.status(204).end();
  } catch (e) { next(e); }
}
