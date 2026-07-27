import { Router } from 'express';
import multer from 'multer';
import { authGuard } from '../middleware/authGuard';
import { requireRole } from '../middleware/requireRole';
import { multerCampaignMedia } from '../middleware/multerCampaignMedia';
import {
  listHandler,
  createHandler,
  updateHandler,
  deleteHandler,
  uploadHeaderMediaHandler,
} from '../controllers/hsmTemplatesController';

// mergeParams so `:instanceId` from the parent mount path is accessible
const router = Router({ mergeParams: true });
const adminOnly = [authGuard, requireRole('admin')];

router.get('/', ...adminOnly, listHandler);
router.post('/', ...adminOnly, createHandler);
// Upload da imagem de header (memória + sharp→JPEG no service). Reusa o multer de
// mídia de campanha (memoryStorage, 5MB, image/*).
router.post(
  '/header-media',
  ...adminOnly,
  (req, res, next) => {
    multerCampaignMedia.single('file')(req, res, (err) => {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'Imagem muito grande (máx. 5MB)' });
      }
      if (err instanceof multer.MulterError) return res.status(400).json({ error: err.message });
      if (err) return next(err);
      next();
    });
  },
  uploadHeaderMediaHandler,
);
router.patch('/:tid', ...adminOnly, updateHandler);
router.delete('/:tid', ...adminOnly, deleteHandler);

export default router;
