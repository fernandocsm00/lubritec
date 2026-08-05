import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { budgetDetections, deals } from '../db/schema';
import { DEAL_STAGES } from '../../shared/types';
import { createDeal, changeStage, getDealByLeadId } from '../services/dealsService';
import { HttpError } from '../middleware/errorHandler';

const leadParams = z.object({ leadId: z.string().uuid() });
const idParams = z.object({ id: z.string().uuid() });
const confirmBody = z.object({
  value: z.number().positive(),
  stage: z.enum(DEAL_STAGES).optional(),
});

export async function pendingHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { leadId } = leadParams.parse(req.params);
    const [row] = await db
      .select()
      .from(budgetDetections)
      .where(and(
        eq(budgetDetections.leadId, leadId),
        eq(budgetDetections.status, 'pending'),
      ))
      .orderBy(desc(budgetDetections.createdAt))
      .limit(1);

    if (!row) return res.json(null);
    return res.json({
      id: row.id,
      messageId: row.messageId,
      leadId: row.leadId,
      detectedValue: Number(row.detectedValue),
      createdAt: row.createdAt.toISOString(),
    });
  } catch (e) {
    next(e);
  }
}

export async function confirmHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    const { value, stage } = confirmBody.parse(req.body);
    const userId = req.user!.id;

    const [det] = await db.select().from(budgetDetections).where(eq(budgetDetections.id, id)).limit(1);
    if (!det) throw new HttpError(404, 'Detecção não encontrada');
    if (det.status !== 'pending') throw new HttpError(409, 'Detecção já resolvida');

    // createDeal é idempotente no ativo: devolve o card aberto se já existir.
    const deal = await createDeal({
      leadId: det.leadId,
      ownerUserId: userId,
      proposalValue: value,
      source: 'manual',
    });

    // O deal pode já existir sem valor — createDeal só aplica proposalValue ao
    // CRIAR. Garante a escrita com um patch explícito.
    await db
      .update(deals)
      .set({ proposalValue: String(value), updatedAt: new Date() })
      .where(eq(deals.id, deal.id));

    if (stage && stage !== deal.stage) {
      await changeStage({ id: deal.id, stage, actorUserId: userId });
    }

    await db
      .update(budgetDetections)
      .set({
        status: 'confirmed',
        confirmedValue: String(value),
        resolvedBy: userId,
        resolvedAt: new Date(),
      })
      .where(eq(budgetDetections.id, id));

    return res.json(await getDealByLeadId(det.leadId));
  } catch (e) {
    next(e);
  }
}

export async function dismissHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    await db
      .update(budgetDetections)
      .set({ status: 'dismissed', resolvedBy: req.user!.id, resolvedAt: new Date() })
      .where(and(eq(budgetDetections.id, id), eq(budgetDetections.status, 'pending')));
    return res.json({ ok: true });
  } catch (e) {
    next(e);
  }
}
