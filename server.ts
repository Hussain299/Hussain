/**
 * SignalForge ML — Full-Stack Server
 * Express API server with Vite dev middleware mounted in development.
 */

import express from 'express';
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { apiRouter } from './src/server/api.js';
import { autonomousScheduler } from './src/server/scheduler.js';
import { db } from './src/server/db.js';
import { selfHealingSupervisor } from './src/server/selfHealingSupervisor.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';

// Historical OHLC imports can be several megabytes; keep an explicit bounded limit.
app.use(express.json({ limit: '100mb' }));

// API Routes
app.use('/api', apiRouter);

// Static public assets (icons, manifest, images)
app.use(express.static(path.resolve(__dirname, 'public')));

// Service Worker & PWA Manifest Explicit Routing with unrestricted scope
app.get('/sw.js', (_req, res) => {
  const swPath = path.resolve(__dirname, 'public', 'sw.js');
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Service-Worker-Allowed', '/');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(swPath);
});

app.get('/manifest.webmanifest', (_req, res) => {
  const manifestPath = path.resolve(__dirname, 'public', 'manifest.webmanifest');
  res.setHeader('Content-Type', 'application/manifest+json');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.sendFile(manifestPath);
});

async function startServer() {
  const fs = await import('fs');
  const distPath = path.resolve(__dirname, 'dist');
  const distIndex = path.join(distPath, 'index.html');
  const useProdStatic = process.env.NODE_ENV === 'production' && fs.existsSync(distIndex);

  if (useProdStatic) {
    app.use(express.static(distPath, {
      maxAge: '1h',
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-store');
        }
      },
    }));
    app.get('*', (req, res, next) => {
      if (req.originalUrl.startsWith('/api')) {
        return next();
      }
      res.setHeader('Cache-Control', 'no-store');
      res.sendFile(distIndex);
    });
  } else {
    // Initialize Vite asynchronously in parallel with app.listen() so TCP port 3000
    // binds immediately and never trips Nginx's 5-second proxy_connect_timeout on cold starts.
    let viteInstance: any = null;
    const viteReadyPromise = (async () => {
      const { createServer: createViteServer } = await import('vite');
      viteInstance = await createViteServer({
        server: {
          middlewareMode: true,
          hmr: false,
          watch: null,
          allowedHosts: true,
        },
        appType: 'spa',
      });
      return viteInstance;
    })();

    // Hold non-API requests cleanly until Vite middleware is ready (zero 502s, zero 404s)
    app.use(async (req, res, next) => {
      if (req.originalUrl.startsWith('/api')) {
        return next();
      }
      try {
        const vite = viteInstance || (await viteReadyPromise);
        vite.middlewares(req, res, next);
      } catch (e) {
        next(e);
      }
    });

    // Serve HTML through Vite in dev mode for SPA fallback
    app.use('*', async (req, res, next) => {
      const url = req.originalUrl;
      if (url.startsWith('/api')) {
        return next();
      }
      try {
        const vite = viteInstance || (await viteReadyPromise);
        let template = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8');
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }).end(template);
      } catch (e: any) {
        if (viteInstance) viteInstance.ssrFixStacktrace(e);
        next(e);
      }
    });
  }

  // Final Express error handler so unhandled route errors never hang sockets
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[SignalForge ML] Express route error:', err?.message || err);
    if (!res.headersSent) {
      res.status(500).json({ error: err?.message || 'Internal server error' });
    }
  });

  // Recover completed learning work before new scheduler decisions can run.
  const outcomeRecovery = db.reconcileClosedSignalLearning();
  const onlineReplay = db.rebuildOnlineLearnerFromHistory();
  console.info(
    '[Learning] Startup recovery complete: ' +
    onlineReplay.replayedOutcomes + ' shadow outcomes replayed; ' +
    outcomeRecovery.forwardObservationsRecovered + ' forward observations and ' +
    outcomeRecovery.strategyOutcomesRecovered + ' strategy outcomes recovered.',
  );

  // Open HTTP port immediately so health checks, /api/cron/tick, and Nginx proxy connections succeed right away
  app.listen(PORT, HOST, () => {
    console.log(`[SignalForge ML] Server running at http://${HOST}:${PORT} (${useProdStatic ? 'production-dist' : 'vite-dev'})`);

    // Defer background scheduler startup slightly so initial cold-start page loads get instant priority
    setTimeout(() => {
      autonomousScheduler.start();
      selfHealingSupervisor.runDiagnosticAndRepair();
    }, 3000);

    // Continuous autonomous self-healing & scheduler watchdog (every 60s)
    setInterval(() => {
      try {
        selfHealingSupervisor.runDiagnosticAndRepair();
        if (!autonomousScheduler.isRunning()) {
          console.warn('[Watchdog] autonomousScheduler was idle! Auto-restarting background coordinator...');
          autonomousScheduler.start();
        }
      } catch {
        // Silently continue
      }
    }, 60 * 1000);
  });
}

const handleGracefulShutdown = (signal: string) => {
  console.log(`[SignalForge ML] Received ${signal}. Flushing database state synchronously...`);
  try {
    autonomousScheduler.stop();
    db.saveStateSync();
  } catch (err: any) {
    console.error('[SignalForge ML] Shutdown flush error:', err?.message || err);
  }
  process.exit(0);
};

process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));
process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));

process.on('uncaughtException', (err: any) => {
  console.error('[SignalForge ML Server] Uncaught exception caught safely:', err?.message || err);
});

process.on('unhandledRejection', (reason: any) => {
  console.error('[SignalForge ML Server] Unhandled promise rejection caught safely:', reason?.message || reason);
});

startServer().catch(err => {
  console.error('[SignalForge ML] Server initialization failed:', err);
  process.exit(1);
});

