import { Router } from 'express';
import { authGuard } from '../middleware/authGuard';
import { requireRole } from '../middleware/requireRole';
import { getHandler, reanalyzeHandler } from '../controllers/caseSheetController';

export const caseSheetRouter = Router();

caseSheetRouter.get('/:leadId/case-sheet', authGuard, getHandler);
caseSheetRouter.post(
  '/:leadId/case-sheet/reanalyze',
  authGuard,
  requireRole('admin'),
  reanalyzeHandler,
);
