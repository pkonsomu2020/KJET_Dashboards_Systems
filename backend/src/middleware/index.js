import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { fromNodeHeaders } from 'better-auth/node';
import { auth } from '../auth/auth.js';

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim());

// ── Security headers ──────────────────────────────────────────
export const helmetMiddleware = helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
});

// ── CORS ──────────────────────────────────────────────────────
export const corsMiddleware = cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (curl, Postman, server-to-server)
    if (!origin) return cb(null, true);
    // In development allow any localhost port automatically
    if (process.env.NODE_ENV !== 'production' && /^http:\/\/localhost:\d+$/.test(origin)) {
      return cb(null, true);
    }
    if (allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});

// ── Request logging ───────────────────────────────────────────
export const loggerMiddleware = morgan(
  process.env.NODE_ENV === 'production' ? 'combined' : 'dev',
);

// ── Gzip compression ─────────────────────────────────────────
export const compressionMiddleware = compression();

// ── Rate limiting ─────────────────────────────────────────────
export const apiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutes
  max: 200,                    // 200 requests per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

// ── Auth guard middleware ─────────────────────────────────────
export async function requireAuth(req, res, next) {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!session?.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    req.user = session.user;
    req.session = session.session;
    next();
  } catch (err) {
    next(err);
  }
}

// ── Global error handler ──────────────────────────────────────
// Must be registered LAST in Express (4 args)
export function errorHandler(err, _req, res, _next) {
  const status = err.status || err.statusCode || 500;
  const message = status < 500 ? err.message : 'Internal server error';
  if (status >= 500) console.error('[Error]', err);
  res.status(status).json({ error: message });
}

// ── 404 fallthrough ───────────────────────────────────────────
export function notFoundHandler(_req, res) {
  res.status(404).json({ error: 'Route not found' });
}

