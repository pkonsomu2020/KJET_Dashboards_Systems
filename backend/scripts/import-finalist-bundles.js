/**
 * Reads the finalists' application forms and document lists from a cohort's bundle folder into the database.
 * Safe to run again. The finance questions of the form are not stored.
 *
 *   node scripts/import-finalist-bundles.js 1 [path to the cohort's bundle folder]
 *
 * Without a path it uses FINALISTS_C<n>_BUNDLES_DIR, else the COHORT_<n>_FINALISTS_BUNDLES folder next to backend/.
 * Run it after the cohort's sheet has been read once (the backend does that on start), so each folder can be checked against its finalist.
 */
import 'dotenv/config';
import pool from '../src/db/pool.js';
import { importBundles } from '../src/services/finalists.js';

const cohort = Number(process.argv[2] ?? 1);
const dir = process.argv[3];
try {
  const r = await importBundles(cohort, { dir, log: (m) => process.stdout.write('.') });
  console.log(`\nCohort ${cohort}: read ${r.read} finalist folders from ${r.root}`);
  if (r.wrongApplication.length) { console.log(`
${r.wrongApplication.length} folder(s) hold ANOTHER cluster's application (nothing from them is shown):`); r.wrongApplication.forEach((p) => console.log('  ' + p)); }
  if (r.problems.length) { console.log(`${r.problems.length} problem(s):`); r.problems.forEach((p) => console.log('  ' + p)); process.exitCode = 1; }
} catch (err) {
  console.error(err.message); process.exitCode = 1;
} finally {
  await pool.end();
  process.exit();
}
