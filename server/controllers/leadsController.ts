import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { LEAD_STATUSES, LEAD_SOURCES, LEAD_FLOW_STAGES, LEAD_QUALITY_FEEDBACK, IMBP_VALUES, SEGMENT_VALUES } from '../../shared/types';
import { createLead, listLeads, updateLead, deleteLead, markLeadLost, getLeadById, closeLeadNoDeal } from '../services/leadsService';
import { importLeadsFromCsv } from '../services/leadsImport';
import { enrichLead } from '../services/leadsEnrichment';
import {
  startBulkEnrichment,
  getCurrentJob,
  cancelCurrentJob,
  pauseCurrentJob,
  resumeCurrentJob,
} from '../services/enrichmentJobs';
import { listLeadTransitions } from '../services/stageTransitions';

const phoneInput = z
  .string()
  .transform((v) => v.replace(/\D/g, ''))
  .pipe(z.string().min(8, 'Phone must have at least 8 digits'));

// Aceita CPF (11 dig) ou CNPJ (14 dig). Check digit eh validado no service.
const cnpjInput = z
  .string()
  .transform((v) => v.replace(/\D/g, ''))
  .pipe(
    z.string().refine(
      (v) => v.length === 11 || v.length === 14,
      'Documento deve ter 11 dígitos (CPF) ou 14 dígitos (CNPJ)',
    ),
  );

// Telefone secundario: vazio/null aceito; quando enviado precisa ter 8+ digitos.
const phone2Input = z
  .string()
  .transform((v) => v.replace(/\D/g, ''))
  .refine((v) => v === '' || v.length >= 8, 'Telefone 2 muito curto')
  .transform((v) => (v === '' ? null : v))
  .nullable();

const extendedFields = {
  phone2: phone2Input.optional(),
  address1: z.string().max(255).nullable().optional(),
  address2: z.string().max(255).nullable().optional(),
  city: z.string().max(120).nullable().optional(),
  imbp: z.enum(IMBP_VALUES).nullable().optional(),
  segment: z.enum(SEGMENT_VALUES).nullable().optional(),
};

const editableCoreCreate = {
  name: z.string().min(2).max(120),
  email: z.string().email().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  ...extendedFields,
};

const editableCoreUpdate = {
  name: z.string().min(1).max(120),
  email: z.string().email().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  ...extendedFields,
};

const createSchema = z.object({
  // Phone agora opcional — leads CNPJ-only são suportados (vão pra enriquecimento).
  phone: phoneInput.optional(),
  cnpj: cnpjInput,
  ...editableCoreCreate,
});
const updateSchema = z
  .object({
    ...editableCoreUpdate,
    status: z.enum(LEAD_STATUSES).optional(),
    // CNPJ e phone são editáveis no payload, mas o service só permite quando o
    // lead atual ainda NÃO tem o campo. Uma vez setado, viram imutáveis.
    cnpj: cnpjInput.optional(),
    phone: phoneInput.optional(),
  })
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: 'At least one field required' });

const idParams = z.object({ id: z.string().uuid() });

const listQuery = z.object({
  q: z.string().optional(),
  status: z.enum(LEAD_STATUSES).optional(),
  source: z.enum(LEAD_SOURCES).optional(),
  flowStage: z.enum(LEAD_FLOW_STAGES).optional(),
  pipeline: z.enum(['yes', 'no']).optional(),
  withIssues: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  sort: z.enum(['name', 'created_at']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).max(100000).optional(),
});

export async function listHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const params = listQuery.parse(req.query);
    const result = await listLeads(params);
    res.json(result);
  } catch (e) {
    next(e);
  }
}

export async function createHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = createSchema.parse(req.body);
    const lead = await createLead(body);
    res.json(lead);
  } catch (e) {
    next(e);
  }
}

export async function updateHandler(req: Request, res: Response, next: NextFunction) {
  try {
    // CNPJ e phone podem vir no payload — o service decide se aceita
    // (só quando o atual é null). Nada a barrar aqui.
    const { id } = idParams.parse(req.params);
    const body = updateSchema.parse(req.body);
    const lead = await updateLead({ id, ...body });
    res.json(lead);
  } catch (e) {
    next(e);
  }
}

export async function deleteHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    await deleteLead(id);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
}

export async function importHandler(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Invalid file type' });
    }
    const report = await importLeadsFromCsv(req.file.buffer);
    res.json(report);
  } catch (e) {
    next(e);
  }
}

export async function enrichHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    const result = await enrichLead(id);
    res.json(result);
  } catch (e) {
    next(e);
  }
}

export async function bulkEnrichStartHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const job = await startBulkEnrichment(req.user!.userId);
    res.json(job);
  } catch (e) { next(e); }
}

export async function bulkEnrichGetHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const job = await getCurrentJob();
    res.json({ job });
  } catch (e) { next(e); }
}

export async function bulkEnrichCancelHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const job = await cancelCurrentJob();
    res.json({ job });
  } catch (e) { next(e); }
}

export async function bulkEnrichPauseHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const job = await pauseCurrentJob();
    res.json({ job });
  } catch (e) { next(e); }
}

export async function bulkEnrichResumeHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const job = await resumeCurrentJob();
    res.json({ job });
  } catch (e) { next(e); }
}

export async function getByIdHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    const lead = await getLeadById(id);
    res.json(lead);
  } catch (e) { next(e); }
}

export async function transitionsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    const transitions = await listLeadTransitions(id);
    res.json({ transitions });
  } catch (e) { next(e); }
}

const lostBody = z.object({
  reason: z.string().max(500).optional(),
});

export async function markLostHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    const body = lostBody.parse(req.body ?? {});
    const lead = await markLeadLost({ id, reason: body.reason ?? null });
    res.json(lead);
  } catch (e) { next(e); }
}

const closeNoDealBody = z.object({
  reason: z.string().trim().min(3).max(500),
  quality: z.enum(LEAD_QUALITY_FEEDBACK),
});

export async function closeNoDealHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    const data = closeNoDealBody.parse(req.body);
    await closeLeadNoDeal({
      leadId: id,
      actorUserId: req.user!.userId,
      reason: data.reason,
      quality: data.quality,
    });
    res.status(204).send();
  } catch (e) { next(e); }
}
