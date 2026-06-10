import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { summary, attention, whatsappStats, macroFunnel, type DashboardLeadFilters } from '../services/dashboardService';
import { getAiMetricsSummary } from '../services/aiMetrics';
import { resolvePeriod } from '../lib/period';
import { IMBP_VALUES, SEGMENT_VALUES } from '../../shared/types';

// Filtros opcionais por atributos do lead destinatário/origem. Aplicados em
// /summary e /macro-funnel. Não afetam WhatsApp/IA/atividades.
const leadFiltersShape = {
  imbp: z.enum(IMBP_VALUES).optional(),
  segment: z.enum(SEGMENT_VALUES).optional(),
  city: z.string().trim().min(1).max(120).optional(),
};

function pickLeadFilters(q: { imbp?: string; segment?: string; city?: string }): DashboardLeadFilters | undefined {
  if (!q.imbp && !q.segment && !q.city) return undefined;
  return { imbp: q.imbp, segment: q.segment, city: q.city };
}

const summaryQuery = z.object({
  view: z.enum(['org', 'me']),
  period: z.enum(['today', '7d', 'month', '30d', 'quarter']),
  ...leadFiltersShape,
});

const attentionQuery = z.object({
  view: z.enum(['org', 'me']),
});

const macroFunnelQuery = z
  .object({
    period: z.enum(['today', '7d', 'month', '30d', 'quarter']).optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    ...leadFiltersShape,
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
    res.json(await summary({
      view: q.view,
      period: q.period,
      userId: req.user!.userId,
      leadFilters: pickLeadFilters(q),
    }));
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

const aiMetricsQuery = z
  .object({
    period: z.enum(['today', '7d', 'month', '30d', 'quarter']).optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  })
  .refine((d) => !!d.period || (!!d.from && !!d.to), { message: 'Forneça period OU from+to' });

export async function aiMetricsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    if (req.user!.role !== 'admin') return res.status(403).json({ error: 'admin only' });
    const q = aiMetricsQuery.parse(req.query);
    let rangeStart: Date;
    let rangeEnd: Date;
    if (q.from && q.to) {
      rangeStart = new Date(q.from);
      rangeEnd = new Date(q.to);
    } else {
      const p = resolvePeriod(q.period ?? '30d');
      rangeStart = p.start;
      rangeEnd = p.end;
    }
    res.json(await getAiMetricsSummary({ rangeStart, rangeEnd }));
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
      leadFilters: pickLeadFilters(q),
    }));
  } catch (e) { next(e); }
}
