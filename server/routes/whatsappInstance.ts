import { Router } from 'express';
import { authGuard } from '../middleware/authGuard';
import { requireRole } from '../middleware/requireRole';
import {
  statusHandler,
  connectHandler,
  disconnectHandler,
  deleteHandler,
  debugEventsHandler,
  clearDebugEventsHandler,
} from '../controllers/whatsappInstanceController';

const router = Router();

const guard = [authGuard, requireRole('admin', 'comercial')];
const adminOnly = [authGuard, requireRole('admin')];

router.get('/', ...guard, statusHandler);
router.post('/connect', ...adminOnly, connectHandler);
router.post('/disconnect', ...adminOnly, disconnectHandler);
router.delete('/', ...adminOnly, deleteHandler);
router.get('/debug-events', ...adminOnly, debugEventsHandler);
router.delete('/debug-events', ...adminOnly, clearDebugEventsHandler);

export default router;
