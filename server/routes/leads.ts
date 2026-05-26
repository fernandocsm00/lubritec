import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import {
  listHandler,
  createHandler,
  updateHandler,
  deleteHandler,
  importHandler,
  enrichHandler,
  bulkEnrichStartHandler,
  bulkEnrichGetHandler,
  bulkEnrichCancelHandler,
  bulkEnrichPauseHandler,
  bulkEnrichResumeHandler,
  transitionsHandler,
  markLostHandler,
  getByIdHandler,
  closeNoDealHandler,
} from '../controllers/leadsController';
import { authGuard } from '../middleware/authGuard';
import { requireRole } from '../middleware/requireRole';
import { multerCsv } from '../middleware/multerCsv';

const router = Router();

router.get('/', authGuard, listHandler);
// Bulk enrichment routes — vêm ANTES de /:id pra não conflitar.
router.get('/enrich-bulk', authGuard, requireRole('admin'), bulkEnrichGetHandler);
router.post('/enrich-bulk', authGuard, requireRole('admin'), bulkEnrichStartHandler);
router.post('/enrich-bulk/cancel', authGuard, requireRole('admin'), bulkEnrichCancelHandler);
router.post('/enrich-bulk/pause', authGuard, requireRole('admin'), bulkEnrichPauseHandler);
router.post('/enrich-bulk/resume', authGuard, requireRole('admin'), bulkEnrichResumeHandler);
router.post('/', authGuard, createHandler);
router.get('/:id', authGuard, getByIdHandler);
router.patch('/:id', authGuard, updateHandler);
router.delete('/:id', authGuard, deleteHandler);
router.post('/:id/enrich', authGuard, enrichHandler);
router.get('/:id/transitions', authGuard, transitionsHandler);
router.post('/:id/lost', authGuard, markLostHandler);
router.post('/:id/close-no-deal', authGuard, closeNoDealHandler);
router.post(
  '/import',
  (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      // Drain the multipart body before responding 401 to avoid ECONNRESET on the client.
      // Mirrors authGuard.ts:17-19 — keep prefix check and error message in sync.
      req.on('data', () => {});
      req.on('end', () => res.status(401).json({ error: 'Missing access token' }));
      req.on('error', () => {
        if (!res.headersSent) res.status(401).json({ error: 'Missing access token' });
      });
      return;
    }
    return authGuard(req, res, next);
  },
  (req: Request, res: Response, next: NextFunction) => {
    multerCsv.single('file')(req, res, (err) => {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large' });
      }
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: err.message });
      }
      if (err) return next(err);
      next();
    });
  },
  importHandler,
);

export default router;
