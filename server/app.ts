import path from 'node:path';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import leadRoutes from './routes/leads';
import whatsappRoutes from './routes/whatsapp';
import conversationRoutes from './routes/conversations';
import messageTemplateRoutes from './routes/messageTemplates';
import dealRoutes from './routes/deals';
import whatsappInstanceRoutes from './routes/whatsappInstance';
import orgSettingsRoutes from './routes/orgSettings';
import campaignRoutes from './routes/campaigns';
import { errorHandler } from './middleware/errorHandler';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);

  const corsOrigin = process.env.APP_URL;
  if (process.env.NODE_ENV === 'production' && !corsOrigin) {
    throw new Error('APP_URL must be set in production');
  }
  app.use(cors({ origin: corsOrigin, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/leads', leadRoutes);
  app.use('/api/whatsapp', whatsappRoutes);
  app.use('/api/conversations', conversationRoutes);
  app.use('/api/message-templates', messageTemplateRoutes);
  app.use('/api/deals', dealRoutes);
  app.use('/api/whatsapp-instance', whatsappInstanceRoutes);
  app.use('/api/org-settings', orgSettingsRoutes);
  app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));
  app.use('/api/campaigns', campaignRoutes);

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  app.use(errorHandler);
  return app;
}
