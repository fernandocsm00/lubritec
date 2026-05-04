import { Router } from 'express';
import { authGuard } from '../middleware/authGuard';
import { requireRole } from '../middleware/requireRole';
import { getHandler, putHandler } from '../controllers/orgSettingsController';

const router = Router();
router.get('/', authGuard, getHandler);
router.put('/', authGuard, requireRole('admin'), putHandler);

export default router;
