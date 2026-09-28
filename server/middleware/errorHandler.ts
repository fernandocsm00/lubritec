import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'Validation error', issues: err.issues });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }
  // Corpo acima do limite do express.json (body-parser): antes virava um 500
  // genérico e a tela só dizia "falha".
  if ((err as { type?: string })?.type === 'entity.too.large') {
    return res.status(413).json({
      error: 'Seleção grande demais para enviar de uma vez. Reduza a lista e tente de novo.',
    });
  }
  console.error(err);
  return res.status(500).json({ error: 'Internal server error' });
}
