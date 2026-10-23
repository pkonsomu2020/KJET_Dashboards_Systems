// dotenv MUST be the very first import. ES imports are hoisted, so a config() call
// placed after them would run too late for modules that read process.env on load.
import 'dotenv/config';

import express from 'express';
import { toNodeHandler } from 'better-auth/node';

import {
  helmetMiddleware,
  corsMiddleware,
  loggerMiddleware,
  compressionMiddleware,
  apiRateLimit,
  errorHandler,
  requireAuth,
  notFoundHandler,
} from './middleware/index.js';

import { auth, ensureDefaultAdmin } from './auth/auth.js';
import { checkDbConnection } from './db/pool.js';
import { checkRedisConnection } from './cache/redis.js';
import { initDriveClient, startChangesPoller, isDriveEnabled, setBroadcaster } from './services/driveService.js';

import healthRouter    from './routes/health.js';
import portfolioRouter from './routes/portfolio.js';
import clustersRouter  from './routes/clusters.js';
import driveRouter     from './routes/drive.js';
import assistantRouter from './routes/assistant.js';
import evaluationRouter from './routes/evaluation.js';
import { ensureEvaluationSchema } from './services/evaluationImport.js';
import pool from './db/pool.js';

const app  = express();
const PORT = process.env.PORT || 4000;
// Behind Nginx the API must only be reachable through the proxy: bind to loopback in production
const HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '127.0.0.1' : undefined);

// One reverse proxy (Nginx) sits in front: trust its X-Forwarded-* headers so the rate limiter
// counts real visitors instead of treating everyone as the proxy's single IP.
app.set('trust proxy', 1);

// ── SSE clients registry (for Drive change push to browser) ──
const sseClients = new Set();

export function broadcastDriveChange(folderIds, applicationNumbers = []) {
  if (sseClients.size === 0) return;
  const payload = JSON.stringify({
    type: 'drive:change',
    folderIds,
    applicationNumbers,
    ts: Date.now(),
  });
  for (const res of sseClients) {
    try { res.write(`data: ${payload}\n\n`); } catch { sseClients.delete(res); }
  }
  console.log(`[SSE] Broadcast drive:change to ${sseClients.size} clients`);
}
setBroadcaster(broadcastDriveChange);

// ── Global middleware ─────────────────────────────────────────
app.use(helmetMiddleware);
app.use(corsMiddleware);
app.options('/*path', corsMiddleware);
app.use(loggerMiddleware);
app.use(compressionMiddleware);

// ── Rate limiting ─────────────────────────────────────────────
app.use('/api', apiRateLimit);

// ── Better Auth (MUST be mounted BEFORE express.json) ─────────
app.all('/api/auth/*path', toNodeHandler(auth));

// ── Body parsers for standard Express routes ──────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ── SSE endpoint — browser subscribes here for live Drive changes ──
// Each open browser tab gets a persistent connection.
// When Drive poller detects a file change, it pushes here → browser refetches folder.
app.get('/api/drive/events', requireAuth, (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');   // disable Nginx buffering if behind proxy
  res.flushHeaders();

  // Send an initial ping so the client knows the connection is alive
  res.write(`data: ${JSON.stringify({ type: 'connected', ts: Date.now() })}\n\n`);

  // Heartbeat every 20s to keep the connection alive through proxies
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { /* ignore */ }
  }, 20_000);

  sseClients.add(res);
  console.log(`[SSE] Client connected (${sseClients.size} total)`);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
    console.log(`[SSE] Client disconnected (${sseClients.size} remaining)`);
  });
});

// ── Routes ───────────────────────────────────────────────────
app.use('/health',        healthRouter);
app.use('/api/portfolio', requireAuth, portfolioRouter);
app.use('/api/clusters',  requireAuth, clustersRouter);
app.use('/api/drive',     requireAuth, driveRouter);
app.use('/api/assistant', requireAuth, assistantRouter);
app.use('/api/evaluation', requireAuth, evaluationRouter);

// ── Root ─────────────────────────────────────────────────────
app.get('/', (_req, res) =>
  res.json({ name: 'KJET Co-Investment API', version: '1.0.0', docs: '/health' }),
);

// ── Error handling ────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

// ── Start ─────────────────────────────────────────────────────
async function start() {
  console.log('\n[KJET API] Starting...\n');
  console.log(`[KJET API] DB: ${process.env.PGUSER}@${process.env.PGHOST}:${process.env.PGPORT}/${process.env.PGDATABASE}`);

  await checkDbConnection();
  await ensureEvaluationSchema(pool);   // creates the (empty) evaluation table if the evaluation was never imported
  await ensureDefaultAdmin();

  const redisOk = await checkRedisConnection();
  if (!redisOk) console.warn('[KJET API] Redis unavailable — running without cache.');

  // Initialize Drive (non-fatal — app works without it)
  const driveOk = await initDriveClient();
  if (driveOk) {
    startChangesPoller();
  }

  app.listen(PORT, HOST, () => {
    console.log(`\n[KJET API] Listening on http://localhost:${PORT}`);
    console.log('[KJET API] Routes:');
    console.log('  GET  /health');
    console.log('  GET  /api/portfolio/summary');
    console.log('  GET  /api/portfolio/by-chain');
    console.log('  GET  /api/portfolio/by-county');
    console.log('  GET  /api/portfolio/compliance');
    console.log('  GET  /api/clusters?county=&chain=&sort=&q=&page=');
    console.log('  GET  /api/clusters/meta');
    console.log('  GET  /api/clusters/:applicationNumber');
    console.log('  GET  /api/drive/status');
    console.log('  GET  /api/drive/events          (SSE — live Drive changes)');
    console.log('  GET  /api/drive/folder/:appNumber');
    console.log('  GET  /api/drive/changes');
    console.log('  GET  /api/evaluation');
    console.log('  POST /api/assistant');
    console.log('  POST /api/auth/sign-up/email');
    console.log('  POST /api/auth/sign-in/email');
    console.log('  POST /api/auth/sign-out\n');
    if (!isDriveEnabled()) {
      console.log('  WARNING: Drive integration OFF — add service-account.json to enable\n');
    }
  });
}

start().catch((err) => {
  console.error('[KJET API] Fatal startup error:', err.message);
  process.exit(1);
});

export { app };
