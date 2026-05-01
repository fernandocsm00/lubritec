import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import leadRoutes from './routes/leads';
import { errorHandler } from './middleware/errorHandler';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);

  const corsOrigin = process.env.APP_URL;
  if (process.env.NODE_ENV === 'production' && !corsOrigin) {
    throw new Error('APP_URL must be set in production');
  }
  app.use(cors({ origin: corsOrigin, credentials: true }));
  app.use(express.json({ strict: false }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/leads', leadRoutes);

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  app.use(errorHandler);
  return app;
}
