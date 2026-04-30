import { Router } from 'express';
import {
  loginHandler,
  refreshHandler,
  logoutHandler,
  meHandler,
  setupPasswordHandler,
  requestResetHandler,
  resetPasswordHandler,
} from '../controllers/authController';
import { authGuard } from '../middleware/authGuard';
import { rateLimit } from '../middleware/rateLimit';

const router = Router();

router.post('/login', rateLimit({ windowMs: 60_000, max: 5 }), loginHandler);
router.post('/refresh', refreshHandler);
router.post('/logout', logoutHandler);
router.get('/me', authGuard, meHandler);

router.post('/setup-password', setupPasswordHandler);
router.post(
  '/request-reset',
  rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    keyFn: (req) => req.body?.email || req.ip || 'anon',
  }),
  requestResetHandler,
);
router.post('/reset-password', resetPasswordHandler);

export default router;
