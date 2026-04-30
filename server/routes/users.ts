import { Router } from 'express';
import { inviteHandler } from '../controllers/usersController';
import { authGuard } from '../middleware/authGuard';
import { requireRole } from '../middleware/requireRole';

const router = Router();

router.post('/', authGuard, requireRole('admin'), inviteHandler);

export default router;
