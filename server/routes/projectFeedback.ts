import { Router } from 'express';
import { authGuard } from '../middleware/authGuard';
import { requireRole } from '../middleware/requireRole';
import { multerProjectFeedback } from '../middleware/multerProjectFeedback';
import { validateUploadMagicBytes } from '../middleware/validateUploadMagicBytes';
import {
  createHandler,
  listHandler,
  updateStatusHandler,
  deleteHandler,
} from '../controllers/projectFeedbackController';

const router = Router();

router.get('/', authGuard, listHandler);
router.post('/', authGuard, multerProjectFeedback.array('images', 5), validateUploadMagicBytes, createHandler);
router.patch('/:id/status', authGuard, requireRole('admin'), updateStatusHandler);
router.delete('/:id', authGuard, deleteHandler);

export default router;
