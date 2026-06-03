import { Router } from 'express';
import multer from 'multer';
import { authGuard } from '../middleware/authGuard';
import { multerConversationMedia } from '../middleware/multerConversationMedia';
import {
  listHandler,
  countsHandler,
  getHandler,
  byLeadHandler,
  listMessagesHandler,
  claimHandler,
  assignHandler,
  queueHandler,
  closeHandler,
  readHandler,
  sendMessageHandler,
  startConversationHandler,
  uploadMediaHandler,
} from '../controllers/conversationsController';

const router = Router();

router.get('/counts', authGuard, countsHandler);
router.get('/by-lead/:leadId', authGuard, byLeadHandler);
router.get('/', authGuard, listHandler);
router.post('/start', authGuard, startConversationHandler);
router.post(
  '/upload-media',
  authGuard,
  (req, res, next) => {
    multerConversationMedia.single('file')(req, res, (err) => {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'Arquivo muito grande (máx. 25MB)' });
      }
      if (err instanceof multer.MulterError) return res.status(400).json({ error: err.message });
      if (err) return next(err);
      next();
    });
  },
  uploadMediaHandler,
);
router.get('/:id', authGuard, getHandler);
router.get('/:id/messages', authGuard, listMessagesHandler);
router.post('/:id/claim', authGuard, claimHandler);
router.post('/:id/assign', authGuard, assignHandler);
router.post('/:id/queue', authGuard, queueHandler);
router.post('/:id/close', authGuard, closeHandler);
router.post('/:id/read', authGuard, readHandler);
router.post('/:id/messages', authGuard, sendMessageHandler);

export default router;
