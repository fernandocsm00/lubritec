import { Router } from 'express';
import { authGuard } from '../middleware/authGuard';
import {
  listHandler,
  countsHandler,
  getHandler,
  listMessagesHandler,
  claimHandler,
  queueHandler,
  closeHandler,
  readHandler,
} from '../controllers/conversationsController';

const router = Router();

router.get('/counts', authGuard, countsHandler);
router.get('/', authGuard, listHandler);
router.get('/:id', authGuard, getHandler);
router.get('/:id/messages', authGuard, listMessagesHandler);
router.post('/:id/claim', authGuard, claimHandler);
router.post('/:id/queue', authGuard, queueHandler);
router.post('/:id/close', authGuard, closeHandler);
router.post('/:id/read', authGuard, readHandler);

export default router;
