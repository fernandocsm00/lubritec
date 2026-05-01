import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import {
  listHandler,
  createHandler,
  updateHandler,
  deleteHandler,
  importHandler,
} from '../controllers/leadsController';
import { authGuard } from '../middleware/authGuard';
import { multerCsv } from '../middleware/multerCsv';

const router = Router();

router.get('/', authGuard, listHandler);
router.post('/', authGuard, createHandler);
router.patch('/:id', authGuard, updateHandler);
router.delete('/:id', authGuard, deleteHandler);
router.post(
  '/import',
  (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      // Drain the multipart body before responding 401 to avoid ECONNRESET on the client.
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
      if (err) return next(err);
      next();
    });
  },
  importHandler,
);

export default router;
