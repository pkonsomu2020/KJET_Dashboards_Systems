/**
 * migrate.js — Creates all tables in the local PostgreSQL database.
 * Run: node scripts/migrate.js
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;
const __dir = dirname(fileURLToPath(import.meta.url));

const pool = new Pool({
  host:     process.env.PGHOST     || 'localhost',
  port:     Number(process.env.PGPORT)    || 5432,
  database: process.env.PGDATABASE || 'kjet',
  user:     process.env.PGUSER     || 'kjet_user',
  password: process.env.PGPASSWORD || 'kjet_pass',
});

async function migrate() {
  console.log('[migrate] Connecting to PostgreSQL...');
  const client = await pool.connect();
  try {
    const sql = readFileSync(join(__dir, '../src/db/schema.sql'), 'utf8');
    console.log('[migrate] Running schema...');
    await client.query(sql);
    console.log('[migrate] ✅ Schema applied successfully.');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error('[migrate] ❌ Failed:', err.message);
  process.exit(1);
});
