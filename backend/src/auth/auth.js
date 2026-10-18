import { betterAuth } from 'better-auth';
import pool from '../db/pool.js';

const configuredOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const devOrigins =
  process.env.NODE_ENV !== 'production'
    ? ['http://localhost:3000', 'http://localhost:4173', 'http://localhost:5173', 'http://localhost:8080']
    : [];

const authSecret = process.env.BETTER_AUTH_SECRET;
if (!authSecret || authSecret.length < 32 || authSecret.startsWith('replace_with')) {
  throw new Error('BETTER_AUTH_SECRET must be set to a random string of at least 32 characters');
}

export const auth = betterAuth({
  secret:  authSecret,
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:4000',

  // ── PostgreSQL via shared pg.Pool ─────────────────────────
  database: pool,

  // ── Table & snake_case column mappings matching schema.sql ─
  user: {
    modelName: 'auth_user',
    fields: {
      emailVerified: 'email_verified',
      createdAt:     'created_at',
      updatedAt:     'updated_at',
    },
  },
  session: {
    modelName: 'auth_session',
    fields: {
      userId:    'user_id',
      expiresAt: 'expires_at',
      ipAddress: 'ip_address',
      userAgent: 'user_agent',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    expiresIn: 60 * 60 * 24 * 7,   // 7 days
    updateAge: 60 * 60 * 24,
    cookieCache: {
      enabled: true,
      maxAge:  5 * 60,
    },
  },
  account: {
    modelName: 'auth_account',
    fields: {
      userId:                'user_id',
      accountId:             'account_id',
      providerId:            'provider_id',
      accessToken:           'access_token',
      refreshToken:          'refresh_token',
      idToken:               'id_token',
      accessTokenExpiresAt:  'access_token_expires_at',
      refreshTokenExpiresAt: 'refresh_token_expires_at',
      createdAt:             'created_at',
      updatedAt:             'updated_at',
    },
  },
  verification: {
    modelName: 'auth_verification',
    fields: {
      expiresAt: 'expires_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },

  // ── Email + password ──────────────────────────────────────
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },

  // ── OAuth providers (activated via env vars) ─────────────
  socialProviders: {
    ...(process.env.GOOGLE_CLIENT_ID && {
      google: {
        clientId:     process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      },
    }),
    ...(process.env.GITHUB_CLIENT_ID && {
      github: {
        clientId:     process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
      },
    }),
  },


  // Behind Nginx the real visitor address is in X-Forwarded-For: without this, login rate limiting
  // would put every visitor into one shared bucket.
  advanced: {
    ipAddress: { ipAddressHeaders: ['x-forwarded-for', 'x-real-ip'] },
  },

  // ── Trusted origins ───────────────────────────────────────
  trustedOrigins: Array.from(new Set([...configuredOrigins, ...devOrigins])),
});

/**
 * Ensures the admin user from ADMIN_* env vars exists in PostgreSQL.
 */
export async function ensureDefaultAdmin() {
  const username = process.env.ADMIN_USERNAME;
  const email    = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!username || !email || !password) {
    console.warn('[Auth] ADMIN_USERNAME / ADMIN_EMAIL / ADMIN_PASSWORD not set. Skipping admin seed.');
    return;
  }

  try {
    const { rows } = await pool.query('SELECT id FROM auth_user WHERE email = $1 LIMIT 1', [email]);
    if (rows.length > 0) return;

    await auth.api.signUpEmail({
      body: { name: username, email, password },
    });
    console.log(`[Auth] Seeded user: ${username}`);
  } catch (err) {
    console.warn('[Auth] Could not seed user:', err.message);
  }
}

export default auth;


