import { Router } from 'express';
import { authGuard } from '../middleware/authGuard';
import { requireRole } from '../middleware/requireRole';
import {
  listHandler,
  detailHandler,
  createHandler,
  patchHandler,
  deleteHandler,
  connectInstanceHandler,
  webhookInfoHandler,
} from '../controllers/whatsappInstancesController';
import { syncHandler } from '../controllers/hsmTemplatesController';

const router = Router();
const adminOnly = [authGuard, requireRole('admin')];

router.get('/', ...adminOnly, listHandler);
router.post('/', ...adminOnly, createHandler);
router.get('/:id', ...adminOnly, detailHandler);
router.patch('/:id', ...adminOnly, patchHandler);
router.delete('/:id', ...adminOnly, deleteHandler);
router.post('/:id/connect', ...adminOnly, connectInstanceHandler);
router.get('/:id/webhook-info', ...adminOnly, webhookInfoHandler);
router.post('/:id/sync-templates', ...adminOnly, syncHandler);

export default router;
