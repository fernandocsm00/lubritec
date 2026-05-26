import { Router } from 'express';
import { authGuard } from '../middleware/authGuard';
import { getHandler, reanalyzeHandler } from '../controllers/caseSheetController';

export const caseSheetRouter = Router();

caseSheetRouter.get('/:leadId/case-sheet', authGuard, getHandler);
caseSheetRouter.post('/:leadId/case-sheet/reanalyze', authGuard, reanalyzeHandler);
