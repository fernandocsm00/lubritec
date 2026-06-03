import { Router } from 'express';
import {
  inviteHandler,
  listHandler,
  updateHandler,
  resendInviteHandler,
  listAssignableHandler,
  listConversationAssigneesHandler,
} from '../controllers/usersController';
import { authGuard } from '../middleware/authGuard';
import { requireRole } from '../middleware/requireRole';

const router = Router();

router.get('/assignable', authGuard, listAssignableHandler);
router.get('/conversation-assignees', authGuard, listConversationAssigneesHandler);
router.get('/', authGuard, requireRole('admin'), listHandler);
router.post('/', authGuard, requireRole('admin'), inviteHandler);
router.patch('/:id', authGuard, requireRole('admin'), updateHandler);
router.post('/:id/resend-invite', authGuard, requireRole('admin'), resendInviteHandler);

export default router;
