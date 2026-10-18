/**
 * sync-all.js — Reads every cluster's Drive application_details.csv and writes it to PostgreSQL.
 * Run: node scripts/sync-all.js
 */
import 'dotenv/config';
import pool from '../src/db/pool.js';
import { initDriveClient, syncAllClusters } from '../src/services/driveService.js';

if (!(await initDriveClient())) {
  console.error('Drive is not configured (service-account.json missing or invalid).');
  process.exit(1);
}
const s = await syncAllClusters();
console.log(`Synced ${s.synced}/${s.total} clusters, ${s.changedFields} fields changed, ${s.failed.length} failed`);
s.failed.forEach((m) => console.error('FAILED', m));
await pool.end();
process.exit(s.failed.length ? 1 : 0);
