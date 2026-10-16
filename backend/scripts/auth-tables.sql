-- Better Auth required tables (camelCase columns as Better Auth expects)
CREATE TABLE IF NOT EXISTS "user" (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  email           TEXT UNIQUE NOT NULL,
  "emailVerified" BOOLEAN     DEFAULT FALSE,
  image           TEXT,
  "createdAt"     TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt"     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS session (
  id           TEXT PRIMARY KEY,
  "expiresAt"  TIMESTAMPTZ NOT NULL,
  token        TEXT UNIQUE NOT NULL,
  "createdAt"  TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt"  TIMESTAMPTZ DEFAULT NOW(),
  "ipAddress"  TEXT,
  "userAgent"  TEXT,
  "userId"     TEXT REFERENCES "user"(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS account (
  id                       TEXT PRIMARY KEY,
  "accountId"              TEXT NOT NULL,
  "providerId"             TEXT NOT NULL,
  "userId"                 TEXT REFERENCES "user"(id) ON DELETE CASCADE,
  "accessToken"            TEXT,
  "refreshToken"           TEXT,
  "idToken"                TEXT,
  "accessTokenExpiresAt"   TIMESTAMPTZ,
  "refreshTokenExpiresAt"  TIMESTAMPTZ,
  scope                    TEXT,
  password                 TEXT,
  "createdAt"              TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt"              TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS verification (
  id           TEXT PRIMARY KEY,
  identifier   TEXT NOT NULL,
  value        TEXT NOT NULL,
  "expiresAt"  TIMESTAMPTZ NOT NULL,
  "createdAt"  TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt"  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_token  ON session(token);
CREATE INDEX IF NOT EXISTS idx_session_userId ON session("userId");
CREATE INDEX IF NOT EXISTS idx_account_userId ON account("userId");
