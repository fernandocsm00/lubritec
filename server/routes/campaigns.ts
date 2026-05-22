import { Router } from 'express';
import multer from 'multer';
import { authGuard } from '../middleware/authGuard';
import { requireRole } from '../middleware/requireRole';
import { multerCampaignMedia } from '../middleware/multerCampaignMedia';
import {
  listHandler,
  getHandler,
  dryRunHandler,
  createHandler,
  dispatchHandler,
  pauseHandler,
  resumeHandler,
  cancelHandler,
  deleteHandler,
  recipientsHandler,
  uploadMediaHandler,
  aggregateStatsHandler,
} from '../controllers/campaignsController';
import {
  getHandler as continuousGetHandler,
  upsertHandler as continuousUpsertHandler,
} from '../controllers/continuousCampaignController';

const router = Router();
const guard = [authGuard, requireRole('admin', 'comercial')];
const adminOnly = [authGuard, requireRole('admin')];

router.get('/continuous', ...guard, continuousGetHandler);
router.put('/continuous', ...adminOnly, continuousUpsertHandler);
router.get('/aggregate-stats', ...guard, aggregateStatsHandler);

router.get('/', ...guard, listHandler);
router.get('/:id', ...guard, getHandler);
router.get('/:id/recipients', ...guard, recipientsHandler);
router.post('/dry-run', ...guard, dryRunHandler);
router.post('/', ...guard, createHandler);
router.post('/:id/dispatch', ...guard, dispatchHandler);
router.post('/:id/pause', ...guard, pauseHandler);
router.post('/:id/resume', ...guard, resumeHandler);
router.post('/:id/cancel', ...guard, cancelHandler);
router.post(
  '/upload-media',
  ...guard,
  (req, res, next) => {
    multerCampaignMedia.single('file')(req, res, (err) => {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large (max 5MB)' });
      }
      if (err instanceof multer.MulterError) return res.status(400).json({ error: err.message });
      if (err) return next(err);
      next();
    });
  },
  uploadMediaHandler,
);
router.delete('/:id', ...adminOnly, deleteHandler);

export default router;
