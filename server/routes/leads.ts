import { Router } from 'express';
import {
  listHandler,
  createHandler,
  updateHandler,
  deleteHandler,
} from '../controllers/leadsController';
import { authGuard } from '../middleware/authGuard';

const router = Router();

router.get('/', authGuard, listHandler);
router.post('/', authGuard, createHandler);
router.patch('/:id', authGuard, updateHandler);
router.delete('/:id', authGuard, deleteHandler);

export default router;
