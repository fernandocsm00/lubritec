import { Router } from 'express';
import { authGuard } from '../middleware/authGuard';
import { requireRole } from '../middleware/requireRole';
import {
  boardHandler,
  historyHandler,
  getHandler,
  createHandler,
  patchHandler,
  stageHandler,
  deleteHandler,
  byLeadHandler,
} from '../controllers/dealsController';

const router = Router();

const guard = [authGuard, requireRole('admin', 'comercial')];
const adminOnly = [authGuard, requireRole('admin')];

router.get('/history', ...guard, historyHandler);
router.get('/by-lead/:leadId', ...guard, byLeadHandler);
router.get('/', ...guard, boardHandler);
router.get('/:id', ...guard, getHandler);
router.post('/', ...guard, createHandler);
router.patch('/:id', ...guard, patchHandler);
router.post('/:id/stage', ...guard, stageHandler);
router.delete('/:id', ...adminOnly, deleteHandler);

export default router;
