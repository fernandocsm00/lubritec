import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { LEAD_STATUSES, LEAD_SOURCES } from '../../shared/types';
import { createLead, listLeads, updateLead, deleteLead } from '../services/leadsService';
import { importLeadsFromCsv } from '../services/leadsImport';

const phoneInput = z
  .string()
  .transform((v) => v.replace(/\D/g, ''))
  .pipe(z.string().min(8, 'Phone must have at least 8 digits'));

const cnpjInput = z
  .string()
  .transform((v) => v.replace(/\D/g, ''))
  .pipe(z.string().length(14, 'CNPJ deve ter 14 dígitos'));

const editableCoreCreate = {
  name: z.string().min(2).max(120),
  email: z.string().email().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
};

const editableCoreUpdate = {
  name: z.string().min(1).max(120),
  email: z.string().email().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
};

const createSchema = z.object({
  phone: phoneInput,
  cnpj: cnpjInput,
  ...editableCoreCreate,
});
const updateSchema = z
  .object({
    ...editableCoreUpdate,
    status: z.enum(LEAD_STATUSES).optional(),
    // CNPJ é editável no payload, mas o service só permite quando o lead atual
    // ainda não tem CNPJ (caso de leads criados via WhatsApp inbound).
    cnpj: cnpjInput.optional(),
  })
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: 'At least one field required' });

const idParams = z.object({ id: z.string().uuid() });

const listQuery = z.object({
  q: z.string().optional(),
  status: z.enum(LEAD_STATUSES).optional(),
  source: z.enum(LEAD_SOURCES).optional(),
  pipeline: z.enum(['yes', 'no']).optional(),
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
    if (req.body && typeof req.body === 'object') {
      if ('phone' in req.body) {
        return res.status(400).json({ error: 'Phone cannot be edited' });
      }
      // CNPJ pode vir no payload — o service decide se aceita (só quando atual é null).
    }
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
