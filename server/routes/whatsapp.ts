import { Router } from 'express';
import { whatsappWebhookHandler } from '../controllers/whatsappWebhookController';

const router = Router();

// Webhook é PÚBLICO — autenticação é via secret no header.
router.post('/webhook', whatsappWebhookHandler);

export default router;
