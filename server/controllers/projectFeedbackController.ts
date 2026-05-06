import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  createFeedback,
  listFeedback,
  updateStatus,
  deleteFeedback,
} from '../services/projectFeedbackService';
import { HttpError } from '../middleware/errorHandler';
import type { AuthedRequest } from '../middleware/authGuard';

const idParamsSchema = z.object({ id: z.string().uuid() });
const statusBodySchema = z.object({
  status: z.enum(['open', 'doing', 'done', 'dismissed']),
});

export async function createHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const content = (req.body?.content ?? '').toString().trim();
    if (content.length < 1) {
      throw new HttpError(400, 'Conteúdo é obrigatório');
    }
    if (content.length > 4000) {
      throw new HttpError(400, 'Conteúdo muito longo (máx 4000 caracteres)');
    }
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    const images = files.map((f) => ({
      path: `/uploads/project-feedback/${f.filename}`,
      originalName: f.originalname,
    }));
    const userId = (req as AuthedRequest).user.userId;
    const row = await createFeedback({ userId, content, images });
    res.status(201).json(row);
  } catch (e) {
    next(e);
  }
}

export async function listHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const items = await listFeedback();
    res.json({ items });
  } catch (e) {
    next(e);
  }
}

export async function updateStatusHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParamsSchema.parse(req.params);
    const { status } = statusBodySchema.parse(req.body);
    const row = await updateStatus(id, status);
    res.json(row);
  } catch (e) {
    next(e);
  }
}

export async function deleteHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParamsSchema.parse(req.params);
    const auth = (req as AuthedRequest).user;
    await deleteFeedback(id, auth.userId, auth.role === 'admin');
    res.status(204).end();
  } catch (e) {
    next(e);
  }
}
