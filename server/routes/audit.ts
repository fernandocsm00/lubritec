import { Router } from 'express';
import { authGuard } from '../middleware/authGuard';
import { requireRole } from '../middleware/requireRole';
import { listHandler, claimHandler, outcomeHandler } from '../controllers/auditController';

export const auditRouter = Router();

const guard = [authGuard, requireRole('admin', 'comercial')];

auditRouter.get('/samples', ...guard, listHandler);
auditRouter.post('/samples/claim', ...guard, claimHandler);
auditRouter.patch('/samples/:id/outcome', ...guard, outcomeHandler);
