import { Router } from 'express';
import { authGuard } from '../middleware/authGuard';
import { requireRole } from '../middleware/requireRole';
import {
  listHandler,
  createHandler,
  updateHandler,
  deleteHandler,
} from '../controllers/hsmTemplatesController';

// mergeParams so `:instanceId` from the parent mount path is accessible
const router = Router({ mergeParams: true });
const adminOnly = [authGuard, requireRole('admin')];

router.get('/', ...adminOnly, listHandler);
router.post('/', ...adminOnly, createHandler);
router.patch('/:tid', ...adminOnly, updateHandler);
router.delete('/:tid', ...adminOnly, deleteHandler);

export default router;
