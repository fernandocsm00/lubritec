import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import leadRoutes from './routes/leads';
import whatsappRoutes from './routes/whatsapp';
import conversationRoutes from './routes/conversations';
import messageTemplateRoutes from './routes/messageTemplates';
import dealRoutes from './routes/deals';
import budgetDetectionRoutes from './routes/budgetDetections';
import whatsappInstanceRoutes from './routes/whatsappInstance';
import whatsappInstancesRouter from './routes/whatsappInstances';
import hsmTemplatesRouter from './routes/hsmTemplates';
import metaWebhookRouter from './routes/whatsappMetaWebhook';
import orgSettingsRoutes from './routes/orgSettings';
import campaignRoutes from './routes/campaigns';
import dashboardRoutes from './routes/dashboard';
import notificationsRoutes from './routes/notifications';
import projectFeedbackRoutes from './routes/projectFeedback';
import { auditRouter } from './routes/audit';
import { caseSheetRouter } from './routes/caseSheet';
import { errorHandler } from './middleware/errorHandler';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);

  // helmet sets security headers (X-Frame-Options, X-Content-Type-Options, HSTS, etc.).
  // CSP só em produção: o dev server do Vite injeta scripts inline/HMR que a
  // policy quebraria. 'unsafe-inline' em style-src é necessário (Tailwind/Motion
  // geram estilos inline); script-src fica restrito a 'self' — que é o que
  // importa contra XSS. img/media liberam https: porque mídias inbound do
  // WhatsApp apontam pra CDN do provider.
  const isProd = process.env.NODE_ENV === 'production';
  app.use(helmet({
    contentSecurityPolicy: isProd
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
            mediaSrc: ["'self'", 'data:', 'blob:', 'https:'],
            connectSrc: ["'self'"],
            fontSrc: ["'self'", 'data:'],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
          },
        }
      : false,
  }));

  const corsOrigin = process.env.APP_URL;
  if (process.env.NODE_ENV === 'production' && !corsOrigin) {
    throw new Error('APP_URL must be set in production');
  }
  app.use(cors({ origin: corsOrigin, credentials: true }));

  // META WEBHOOK — must come BEFORE the global express.json() so the raw body
  // is captured via the verify callback (needed for HMAC signature check).
  // Path-scoped JSON parser only applies to /api/whatsapp/webhook/meta/*.
  app.use(
    '/api/whatsapp/webhook/meta',
    express.json({
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
      },
    }),
    metaWebhookRouter,
  );

  app.use(express.json());
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.get('/api/health/ready', async (_req, res) => {
    const checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {};

    // DB check
    const dbStart = Date.now();
    try {
      const { pool } = await import('./db/client');
      await pool.query('SELECT 1');
      checks.db = { ok: true, latencyMs: Date.now() - dbStart };
    } catch (e) {
      checks.db = { ok: false, latencyMs: Date.now() - dbStart, error: e instanceof Error ? e.message : 'unknown' };
    }

    // UazAPI check — non-fatal: instance might be intentionally disconnected.
    const uazStart = Date.now();
    try {
      const { loadSendConfig } = await import('./services/whatsappInstanceService');
      const cfg = await loadSendConfig().catch(() => null);
      if (!cfg) {
        checks.uazapi = { ok: false, error: 'not_configured' };
      } else {
        // Lightweight: just check the base URL responds. Avoid hitting protected
        // endpoints that would consume rate budget.
        const r = await fetch(cfg.baseUrl, { signal: AbortSignal.timeout(3000) });
        checks.uazapi = { ok: r.ok || r.status === 404, latencyMs: Date.now() - uazStart };
      }
    } catch (e) {
      checks.uazapi = { ok: false, latencyMs: Date.now() - uazStart, error: e instanceof Error ? e.message : 'unknown' };
    }

    // Dispatcher de campanhas: se o último tick tem >5min (tick é a cada 60s),
    // o worker morreu silenciosamente — campanhas travam sem nenhum sintoma.
    // Não-fatal pro ready (DB é o gate), mas visível pra monitoramento.
    try {
      const { getDispatcherLastTickAt } = await import('./services/campaignsDispatcher');
      const lastTick = getDispatcherLastTickAt();
      checks.dispatcher = {
        ok: lastTick !== null && Date.now() - lastTick.getTime() < 5 * 60_000,
        error: lastTick ? undefined : 'no_tick_yet',
      };
    } catch (e) {
      checks.dispatcher = { ok: false, error: e instanceof Error ? e.message : 'unknown' };
    }

    // Overall: DB must be up. UazAPI being down is degraded, not failed.
    const overallOk = checks.db.ok;
    res.status(overallOk ? 200 : 503).json({ ok: overallOk, checks });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/leads', leadRoutes);
  app.use('/api/whatsapp', whatsappRoutes);
  app.use('/api/conversations', conversationRoutes);
  app.use('/api/message-templates', messageTemplateRoutes);
  app.use('/api/deals', dealRoutes);
  app.use('/api/budget-detections', budgetDetectionRoutes);
  app.use('/api/whatsapp-instance', whatsappInstanceRoutes);
  app.use('/api/whatsapp/instances', whatsappInstancesRouter);
  app.use('/api/whatsapp/instances/:instanceId/templates', hsmTemplatesRouter);
  app.use('/api/org-settings', orgSettingsRoutes);
  // Uploads são "capability URLs": filename = crypto.randomBytes(16) (128 bits,
  // não-enumerável) — mesmo modelo de link do WhatsApp/Drive. Auth por header
  // não funciona aqui (<img src> não envia Authorization e o provider WhatsApp
  // baixa a mídia desta URL ao disparar campanha). dotfiles/index bloqueados;
  // a validação de conteúdo (magic bytes) acontece no upload.
  app.use('/uploads', express.static(path.join(process.cwd(), 'uploads'), {
    dotfiles: 'deny',
    index: false,
    maxAge: '1d',
  }));
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/campaigns', campaignRoutes);
  app.use('/api/notifications', notificationsRoutes);
  app.use('/api/project-feedback', projectFeedbackRoutes);
  app.use('/api/audit', auditRouter);
  app.use('/api/leads', caseSheetRouter);

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // SPA: serve the Vite build and fall back to index.html for client-side routes.
  // Must come after /api routes so unknown API paths still return JSON 404.
  if (process.env.NODE_ENV === 'production') {
    const distDir = path.join(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
