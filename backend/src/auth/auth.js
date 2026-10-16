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

export const auth = betterAuth({
  secret:  process.env.BETTER_AUTH_SECRET || 'kjet-dev-secret-change-in-production-32chars',
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

  // ── Session ───────────────────────────────────────────────
  session: {
    expiresIn: 60 * 60 * 24 * 7,   // 7 days
    updateAge: 60 * 60 * 24,
    cookieCache: {
      enabled: true,
      maxAge:  5 * 60,
    },
  },

  // ── Trusted origins ───────────────────────────────────────
  trustedOrigins: Array.from(new Set([...configuredOrigins, ...devOrigins])),
});

/**
 * Ensures the LeadedgeConsults user exists in PostgreSQL and removes any old default user.
 */
export async function ensureDefaultAdmin() {
  const username = process.env.ADMIN_USERNAME || 'LeadedgeConsults';
  const email    = process.env.ADMIN_EMAIL    || 'leadedgeconsults@kjet.local';
  const password = process.env.ADMIN_PASSWORD || 'Leadedge@2026';

  try {
    // Remove previous default placeholder account if present
    await pool.query("DELETE FROM auth_user WHERE email = 'admin@msea.go.ke'");

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


