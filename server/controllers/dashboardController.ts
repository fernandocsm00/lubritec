import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { summary, attention, whatsappStats, macroFunnel } from '../services/dashboardService';

const summaryQuery = z.object({
  view: z.enum(['org', 'me']),
  period: z.enum(['today', '7d', 'month', '30d', 'quarter']),
});

const attentionQuery = z.object({
  view: z.enum(['org', 'me']),
});

const macroFunnelQuery = z
  .object({
    period: z.enum(['today', '7d', 'month', '30d', 'quarter']).optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  })
  .refine(
    (d) => !!d.period || (!!d.from && !!d.to),
    { message: 'Forneça period OU from+to' },
  )
  .refine(
    (d) => !d.from || !d.to || new Date(d.from) < new Date(d.to),
    { message: 'from precisa ser antes de to' },
  );

export async function summaryHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const q = summaryQuery.parse(req.query);
    if (q.view === 'org' && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'admin only' });
    }
    res.json(await summary({ view: q.view, period: q.period, userId: req.user!.userId }));
  } catch (e) { next(e); }
}

export async function attentionHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const q = attentionQuery.parse(req.query);
    if (q.view === 'org' && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'admin only' });
    }
    res.json(await attention({ view: q.view, userId: req.user!.userId }));
  } catch (e) { next(e); }
}

export async function whatsappHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await whatsappStats());
  } catch (e) { next(e); }
}

export async function macroFunnelHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const q = macroFunnelQuery.parse(req.query);
    // Visão macro é organizacional (não particionada por usuário). Admin only.
    if (req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'admin only' });
    }
    res.json(await macroFunnel({
      period: q.period,
      rangeStart: q.from ? new Date(q.from) : undefined,
      rangeEnd: q.to ? new Date(q.to) : undefined,
    }));
  } catch (e) { next(e); }
}
