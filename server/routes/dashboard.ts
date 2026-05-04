import { Router } from 'express';
import { authGuard } from '../middleware/authGuard';
import { requireRole } from '../middleware/requireRole';
import { summaryHandler, attentionHandler, whatsappHandler } from '../controllers/dashboardController';

const router = Router();

router.get('/summary',   authGuard, summaryHandler);                            // RBAC inside (view-dependent)
router.get('/attention', authGuard, attentionHandler);                          // RBAC inside
router.get('/whatsapp',  authGuard, requireRole('admin'), whatsappHandler);     // admin only

export default router;
