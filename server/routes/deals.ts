import { Router } from 'express';
import { authGuard } from '../middleware/authGuard';
import { requireRole } from '../middleware/requireRole';
import {
  boardHandler,
  historyHandler,
  getHandler,
} from '../controllers/dealsController';

const router = Router();

const guard = [authGuard, requireRole('admin', 'comercial')];

// IMPORTANTE: /history antes de /:id senão "history" vira id e dá 400 (UUID inválido).
router.get('/history', ...guard, historyHandler);
router.get('/', ...guard, boardHandler);
router.get('/:id', ...guard, getHandler);

export default router;
