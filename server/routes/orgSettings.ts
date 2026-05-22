import { Router } from 'express';
import { authGuard } from '../middleware/authGuard';
import { requireRole } from '../middleware/requireRole';
import { getHandler, putHandler, testPromptHandler } from '../controllers/orgSettingsController';

const router = Router();
router.get('/', authGuard, getHandler);
router.put('/', authGuard, requireRole('admin'), putHandler);
router.post('/test-ai-prompt', authGuard, requireRole('admin'), testPromptHandler);

export default router;
