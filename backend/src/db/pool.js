import pg from 'pg';

const { Pool } = pg;

// DATE columns (e.g. registration_date) must stay plain "YYYY-MM-DD" text. By default pg turns them into
// a local-midnight JS Date, which becomes the previous day in UTC and showed 2013-08-18 for 2013-08-19.
pg.types.setTypeParser(1082, (value) => value);

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
