import 'dotenv/config';
import { createApp } from './app';
import { startDispatcher } from './services/campaignsDispatcher';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function start() {
  const app = createApp();
  const PORT = Number(process.env.PORT || 3000);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
      root: path.resolve(__dirname, '..'),
    });
    app.use(vite.middlewares);
  } else {
    // Both dev and prod run via tsx from the source tree, so __dirname is
    // <root>/server and the Vite build sits at <root>/dist.
    const distDir = path.resolve(__dirname, '../dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distDir, 'index.html'));
    });
  }

  app.listen(PORT, () => {
    console.log(`LubriConnect server on http://localhost:${PORT}`);
  });

  startDispatcher();
  console.log('[campaigns] dispatcher started (tick every 60s)');
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
