import { Router } from 'express';
import {
  inviteHandler,
  listHandler,
  updateHandler,
} from '../controllers/usersController';
import { authGuard } from '../middleware/authGuard';
import { requireRole } from '../middleware/requireRole';

const router = Router();

router.get('/', authGuard, requireRole('admin'), listHandler);
router.post('/', authGuard, requireRole('admin'), inviteHandler);
router.patch('/:id', authGuard, requireRole('admin'), updateHandler);

export default router;
