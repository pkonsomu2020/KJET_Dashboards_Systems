/**
 * import-evaluation.js: loads the evaluation workbook's results into PostgreSQL.
 *
 *   node scripts/import-evaluation.js "<path to KJET_CoInvestment_Evaluation_Tool ... .xlsx>"
 *
 * Manual load of a downloaded copy (the server normally reads the online sheet by itself). Replaces the previous evaluation in one transaction and
 * never touches application data.
 */
import 'dotenv/config';
import { existsSync } from 'fs';
import pool from '../src/db/pool.js';
import { importEvaluation } from '../src/services/evaluationImport.js';
import { cacheInvalidate } from '../src/cache/redis.js';

const path = process.argv[2] ?? process.env.EVALUATION_XLSX;
if (!path || !existsSync(path)) {
  console.error('Usage: node scripts/import-evaluation.js "<path to the evaluation workbook .xlsx>"');
  process.exit(1);
}
try {
  const r = await importEvaluation(pool, path);
  await Promise.allSettled([cacheInvalidate('clusters:list:*'), cacheInvalidate('cluster:detail:*'), cacheInvalidate('evaluation:*')]);
  console.log(`Imported ${r.imported} clusters (${r.shortlisted} on the grant-ready list) from ${r.sourceFile}`);
  await pool.end();
  process.exit(0);
} catch (err) {
  console.error('Import failed (nothing was changed):', err.message);
  await pool.end();
  process.exit(1);
}
