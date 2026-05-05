import { Router } from 'express';
import { authGuard } from '../middleware/authGuard';
import { requireRole } from '../middleware/requireRole';
import {
  summaryHandler,
  attentionHandler,
  whatsappHandler,
  macroFunnelHandler,
  aiMetricsHandler,
} from '../controllers/dashboardController';

const router = Router();

router.get('/summary',      authGuard, summaryHandler);                            // RBAC inside (view-dependent)
router.get('/attention',    authGuard, attentionHandler);                          // RBAC inside
router.get('/whatsapp',     authGuard, requireRole('admin'), whatsappHandler);     // admin only
router.get('/macro-funnel', authGuard, requireRole('admin'), macroFunnelHandler);  // admin only
router.get('/ai-metrics',   authGuard, requireRole('admin'), aiMetricsHandler);    // admin only

export default router;
