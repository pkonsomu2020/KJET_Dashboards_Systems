/**
 * drive-live-change.js — Measures how long a real Drive edit takes to reach the database.
 *
 * 1. Start the backend:            npm run dev          (the 30-second poller must be running)
 * 2. In another terminal:          node tests/drive-live-change.js KJET-2026-512686
 * 3. When it says GO, edit that cluster's application_details.csv in Google Drive
 *    (for example change "Jobs year3" to another number) or upload/rename/delete any file in
 *    that cluster's folders.
 * 4. The script prints how many seconds passed until PostgreSQL reflected the change.
 *
 * It only reads the database. Edit the same file back afterwards to restore your data.
 */
import 'dotenv/config';
import pool from '../src/db/pool.js';

const app = process.argv[2];
if (!app) { console.error('Usage: node tests/drive-live-change.js <application number>'); process.exit(1); }

const state = async () => {
  const { rows: [r] } = await pool.query(`
    SELECT c.updated_at,
           (SELECT COUNT(*)::int FROM cluster_documents d WHERE d.cluster_id = c.id) docs,
           (SELECT COALESCE(MAX(id), 0) FROM drive_sync_log l WHERE l.cluster_id = c.id) last_log
    FROM clusters c WHERE c.application_number = $1`, [app]);
  return r;
};

const start = await state();
if (!start) { console.error(`Cluster ${app} not found`); process.exit(1); }
console.log(`Watching ${app}. GO: change something in its Drive folder now...`);
const t0 = Date.now();
const limit = t0 + 5 * 60 * 1000;

while (Date.now() < limit) {
  await new Promise((r) => setTimeout(r, 1000));
  const now = await state();
  if (String(now.updated_at) !== String(start.updated_at) || now.docs !== start.docs || now.last_log !== start.last_log) {
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\nDatabase updated ${secs}s after you started watching.`);
    if (now.last_log !== start.last_log) {
      const { rows } = await pool.query(
        'SELECT table_name, field, old_value, new_value FROM drive_sync_log WHERE cluster_id = (SELECT id FROM clusters WHERE application_number = $1) AND id > $2 ORDER BY id',
        [app, start.last_log]);
      rows.forEach((r) => console.log(`  ${r.table_name}.${r.field}: ${r.old_value} -> ${r.new_value}`));
    } else if (now.docs !== start.docs) {
      console.log(`  document count ${start.docs} -> ${now.docs}`);
    }
    console.log(Number(secs) <= 45 ? 'PASS: within the expected 30s poll + sync time.' : 'SLOW: investigate the poller.');
    await pool.end();
    process.exit(0);
  }
}
console.log('No database change seen within 5 minutes. Is the backend running with Drive enabled?');
await pool.end();
process.exit(1);
