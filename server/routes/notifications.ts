import { Router } from 'express';
import { authGuard } from '../middleware/authGuard';
import {
  listHandler,
  unreadCountHandler,
  markReadHandler,
  markAllReadHandler,
} from '../controllers/notificationsController';

const router = Router();

router.get('/', authGuard, listHandler);
router.get('/unread-count', authGuard, unreadCountHandler);
router.post('/:id/read', authGuard, markReadHandler);
router.post('/read-all', authGuard, markAllReadHandler);

export default router;
