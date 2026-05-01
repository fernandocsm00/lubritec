import { Router } from 'express';
import { authGuard } from '../middleware/authGuard';
import {
  listHandler,
  createHandler,
  updateHandler,
  deleteHandler,
} from '../controllers/messageTemplatesController';

const router = Router();

router.get('/', authGuard, listHandler);
router.post('/', authGuard, createHandler);
router.patch('/:id', authGuard, updateHandler);
router.delete('/:id', authGuard, deleteHandler);

export default router;
