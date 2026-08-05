import { Router } from 'express';
import { authGuard } from '../middleware/authGuard';
import { requireRole } from '../middleware/requireRole';
import {
  pendingHandler,
  confirmHandler,
  dismissHandler,
} from '../controllers/budgetDetectionsController';

const router = Router();

// Mesmo RBAC do pipeline: quem não pode mexer em deal não vê nem resolve sugestão.
const guard = [authGuard, requireRole('admin', 'comercial')];

router.get('/pending/:leadId', ...guard, pendingHandler);
router.post('/:id/confirm', ...guard, confirmHandler);
router.post('/:id/dismiss', ...guard, dismissHandler);

export default router;
