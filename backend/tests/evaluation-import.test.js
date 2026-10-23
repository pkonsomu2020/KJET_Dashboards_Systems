/**
 * evaluation-import.test.js: checks the evaluation stored in PostgreSQL against the workbook,
 * reading the workbook by raw cell address (a different route from the importer, which finds
 * columns by header name).
 *
 *   node tests/evaluation-import.test.js ["<path to workbook>"]
 *
 * Read-only.
 */
import 'dotenv/config';
import { createRequire } from 'module';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import pool from '../src/db/pool.js';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const root = join(import.meta.dirname, '..', '..');
const path = process.argv[2] ?? join(root, readdirSync(root).find((f) => /^KJET_CoInvestment_Evaluation_Tool.*\.xlsx$/.test(f)) ?? 'missing.xlsx');
if (!existsSync(path)) { console.error('Workbook not found:', path); process.exit(1); }

let passed = 0, failed = 0;
const failures = [];
const check = (label, ok, detail = '') => { if (ok) passed++; else { failed++; failures.push(`${label} | ${detail}`); console.error(`  FAIL  ${label} | ${detail}`); } };
const norm = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

const wb = XLSX.readFile(path, { cellDates: false });
const cell = (sheet, ref) => wb.Sheets[sheet][ref]?.v ?? '';

const { rows: db } = await pool.query('SELECT * FROM cluster_evaluation ORDER BY application_number');
const byApp = new Map(db.map((r) => [r.application_number, r]));

// Final_Decision by cell address: B app, H cost, I grant requested, J max eligible, K financial, L data, M eligibility,
// N score, O band, P rank, Q county rank, R due diligence, T E&S, U system rec, W technical rec, X MSEA, Y approved grant
let wbRows = 0;
for (let r = 6; r <= 120; r++) {
  const app = norm(cell('Final_Decision', `B${r}`));
  if (!app.startsWith('KJET-')) continue;
  wbRows++;
  const d = byApp.get(app);
  check(`${app} stored`, !!d);
  if (!d) continue;
  const txt = (ref, col) => check(`${app} ${col}`, norm(cell('Final_Decision', ref)) === norm(d[col]), `${JSON.stringify(cell('Final_Decision', ref))} vs ${JSON.stringify(d[col])}`);
  const num = (ref, col) => { const w = cell('Final_Decision', ref); const h = d[col] == null ? null : Number(d[col]); const x = w === '' ? null : Number(w); check(`${app} ${col}`, (h === null && x === null) || (h !== null && x !== null && Math.abs(h - x) < 0.005), `${w} vs ${d[col]}`); };
  num(`H${r}`, 'eval_total_cost'); num(`I${r}`, 'eval_grant_requested'); num(`J${r}`, 'max_eligible_grant');
  txt(`K${r}`, 'financial_screening'); txt(`L${r}`, 'data_readiness'); txt(`M${r}`, 'eligibility');
  num(`N${r}`, 'total_score'); txt(`O${r}`, 'band'); num(`P${r}`, 'rank'); num(`Q${r}`, 'county_rank');
  txt(`R${r}`, 'due_diligence'); txt(`T${r}`, 'es_disposition'); txt(`U${r}`, 'system_recommendation');
  txt(`W${r}`, 'technical_rec'); txt(`X${r}`, 'msea_decision'); num(`Y${r}`, 'approved_grant');
}
check('85 clusters in the workbook', wbRows === 85, String(wbRows));
check('85 clusters stored', db.length === 85, String(db.length));

// SCORECARD by cell address: C app, P/Y/AE/AJ/AO/AU weighted, O/X/AD/AI/AN/AT ratings, AY total
const rating = ['O', 'X', 'AD', 'AI', 'AN', 'AT'];
const weighted = ['P', 'Y', 'AE', 'AJ', 'AO', 'AU'];
for (let r = 6; r <= 120; r++) {
  const app = norm(cell('SCORECARD', `C${r}`));
  if (!app.startsWith('KJET-')) continue;
  const d = byApp.get(app);
  if (!d) continue;
  for (let c = 0; c < 6; c++) {
    check(`${app} C${c + 1} rating`, Math.abs(Number(cell('SCORECARD', `${rating[c]}${r}`)) - Number(d[`c${c + 1}_rating`])) < 0.005, `${cell('SCORECARD', `${rating[c]}${r}`)} vs ${d[`c${c + 1}_rating`]}`);
    check(`${app} C${c + 1} weighted score`, Math.abs(Number(cell('SCORECARD', `${weighted[c]}${r}`)) - Number(d[`c${c + 1}_score`])) < 0.005, `${cell('SCORECARD', `${weighted[c]}${r}`)} vs ${d[`c${c + 1}_score`]}`);
  }
  check(`${app} scorecard total equals Final_Decision total`, Math.abs(Number(cell('SCORECARD', `AY${r}`)) - Number(d.total_score)) < 0.005, `${cell('SCORECARD', `AY${r}`)} vs ${d.total_score}`);
  const sum = [1, 2, 3, 4, 5, 6].reduce((s, c) => s + Number(d[`c${c}_score`] ?? 0), 0);
  check(`${app} criteria add up to the total score`, Math.abs(sum - Number(d.total_score)) < 1, `sum ${sum} vs ${d.total_score}`);
  check(`${app} has written justifications`, [1, 2, 3, 4, 5, 6].every((c) => norm(d[`c${c}_evidence`]).length > 0), 'missing text');
  const band = Number(d.total_score) >= 70 ? 'Recommended' : Number(d.total_score) >= 50 ? 'Referred with Comments' : 'Rejected';
  check(`${app} band follows the score rule (70 / 50)`, norm(d.band).toLowerCase() === band.toLowerCase(), `${d.total_score} -> ${d.band}`);
}

// Grant Ready Clusters by cell address: rows 4..: A rank, B app, F score, H reason
const listed = [];
for (let r = 4; r <= 60; r++) { const app = norm(cell('Grant Ready Clusters', `B${r}`)); if (app.startsWith('KJET-')) listed.push({ app, rank: Number(cell('Grant Ready Clusters', `A${r}`)), score: Number(cell('Grant Ready Clusters', `F${r}`)), reason: norm(cell('Grant Ready Clusters', `H${r}`)) }); }
check('shortlist size matches', db.filter((d) => d.shortlisted).length === listed.length, `${db.filter((d) => d.shortlisted).length} vs ${listed.length}`);
for (const l of listed) {
  const d = byApp.get(l.app);
  check(`${l.app} shortlisted at rank ${l.rank}`, d?.shortlisted === true && d.shortlist_rank === l.rank, `${d?.shortlisted}/${d?.shortlist_rank}`);
  check(`${l.app} shortlist score matches stored score`, Number(d?.total_score) === l.score, `${l.score} vs ${d?.total_score}`);
  check(`${l.app} shortlist reason stored`, norm(d?.shortlist_reason) === l.reason && l.reason.length > 20, 'reason differs');
}
check('no one outside the list is marked shortlisted', db.filter((d) => d.shortlisted && !listed.some((l) => l.app === d.application_number)).length === 0);
check('shortlist is in score order', listed.every((l, i) => i === 0 || l.score <= listed[i - 1].score));

console.log(`\nResults: ${passed} passed, ${failed} failed  (workbook: ${path.split(/[\\/]/).pop()})`);
if (failed) failures.slice(0, 15).forEach((f) => console.log('  -', f));
await pool.end();
process.exit(failed ? 1 : 0);
