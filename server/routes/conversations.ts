import { Router } from 'express';
import { authGuard } from '../middleware/authGuard';
import {
  listHandler,
  countsHandler,
  getHandler,
} from '../controllers/conversationsController';

const router = Router();

// IMPORTANTE: /counts antes de /:id senão o id consume "counts".
router.get('/counts', authGuard, countsHandler);
router.get('/', authGuard, listHandler);
router.get('/:id', authGuard, getHandler);

export default router;
