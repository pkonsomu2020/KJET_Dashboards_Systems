import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  host:     process.env.PGHOST     || 'localhost',
  port:     Number(process.env.PGPORT)    || 5432,
  database: process.env.PGDATABASE || 'kjet',
  user:     process.env.PGUSER     || 'kjet_user',
  password: process.env.PGPASSWORD || 'kjet_pass',
  max: 10,                // max pool connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

/**
 * Quick connectivity check — resolves true or throws.
 */
export async function checkDbConnection() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT NOW() AS now, version() AS version');
    console.log(`[DB] Connected — ${rows[0].version.split(' ').slice(0, 2).join(' ')}`);
    return true;
  } finally {
    client.release();
  }
}

export default pool;
