import { Router } from 'express';
import { authGuard } from '../middleware/authGuard';
import {
  listHandler,
  countsHandler,
  getHandler,
  byLeadHandler,
  listMessagesHandler,
  claimHandler,
  queueHandler,
  closeHandler,
  readHandler,
  sendMessageHandler,
  startConversationHandler,
} from '../controllers/conversationsController';

const router = Router();

router.get('/counts', authGuard, countsHandler);
router.get('/by-lead/:leadId', authGuard, byLeadHandler);
router.get('/', authGuard, listHandler);
router.post('/start', authGuard, startConversationHandler);
router.get('/:id', authGuard, getHandler);
router.get('/:id/messages', authGuard, listMessagesHandler);
router.post('/:id/claim', authGuard, claimHandler);
router.post('/:id/queue', authGuard, queueHandler);
router.post('/:id/close', authGuard, closeHandler);
router.post('/:id/read', authGuard, readHandler);
router.post('/:id/messages', authGuard, sendMessageHandler);

export default router;
