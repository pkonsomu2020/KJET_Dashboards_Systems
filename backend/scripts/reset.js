/**
 * reset.js — Drops and recreates the kjet database. DEV ONLY.
 * Run: node scripts/reset.js
 */
import pg from 'pg';
import 'dotenv/config';

const { Client } = pg;

async function reset() {
  if (process.env.NODE_ENV === 'production') {
    console.error('[reset] ❌ Refusing to run in production.');
    process.exit(1);
  }

  // Connect to postgres (not kjet) to drop/create the DB
  const client = new Client({
    host:     process.env.PGHOST     || 'localhost',
    port:     Number(process.env.PGPORT)    || 5432,
    database: 'postgres',
    user:     process.env.PGUSER     || 'kjet_user',
    password: process.env.PGPASSWORD || 'kjet_pass',
  });

  await client.connect();
  const db = process.env.PGDATABASE || 'kjet';

  console.log(`[reset] Dropping database '${db}'...`);
  await client.query(`DROP DATABASE IF EXISTS "${db}"`);
  console.log(`[reset] Creating database '${db}'...`);
  await client.query(`CREATE DATABASE "${db}" OWNER "${process.env.PGUSER || 'kjet_user'}"`);
  await client.end();

  console.log('[reset] ✅ Database reset. Run: node scripts/migrate.js && node scripts/seed.js');
}

reset().catch((err) => {
  console.error('[reset] Fatal:', err.message);
  process.exit(1);
});
