/**
 * evaluation-import.test.js: checks the evaluation stored in PostgreSQL against the online
 * evaluation sheet, reading the sheet by raw cell address (a different route from the importer, which
 * finds columns by header name), then checks the screening rules against the sheet's own results.
 *
 *   node tests/evaluation-import.test.js            (downloads the online sheet)
 *   node tests/evaluation-import.test.js "<path to a downloaded copy>"
 *
 * Read-only.
 */
import 'dotenv/config';
import { createRequire } from 'module';
import { existsSync } from 'fs';
import pool from '../src/db/pool.js';
import { initDriveClient, getDriveClient } from '../src/services/driveService.js';
import { screenFinancials } from '../src/services/financialScreening.js';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

let wb;
if (process.argv[2]) {
  if (!existsSync(process.argv[2])) { console.error('Workbook not found:', process.argv[2]); process.exit(1); }
  wb = XLSX.readFile(process.argv[2], { cellDates: false });
} else {
  await initDriveClient();
  const drive = getDriveClient();
  if (!drive || !process.env.EVALUATION_SHEET_ID) { console.error('Drive or EVALUATION_SHEET_ID not configured'); process.exit(1); }
  const res = await drive.files.export({ fileId: process.env.EVALUATION_SHEET_ID, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, { responseType: 'arraybuffer' });
  wb = XLSX.read(Buffer.from(res.data), { type: 'buffer', cellDates: false });
}

let passed = 0, failed = 0;
const failures = [];
const check = (label, ok, detail = '') => { if (ok) passed++; else { failed++; failures.push(`${label} | ${detail}`); console.error(`  FAIL  ${label} | ${detail}`); } };
// the sheet says Category 1 / Category 2 / Exceeds KES 32M cap; the dashboard uses the Operations Manual's names for the windows
const WINDOW = { 'Category 1': 'Window 1 (Growth Window)', 'Category 2': 'Window 2 (Transformational Window)', 'Exceeds KES 32M cap': 'Above the Window 2 ceiling', 'Invalid grant (≤0)': 'Invalid grant (zero or less)', 'Incomplete data': 'Incomplete data' };
const norm = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const cell = (sheet, ref) => wb.Sheets[sheet][ref]?.v ?? '';
const close = (a, b) => (a == null && b == null) || (a != null && b != null && Math.abs(Number(a) - Number(b)) < 0.005);

const { rows: db } = await pool.query('SELECT * FROM cluster_evaluation ORDER BY application_number');
const byApp = new Map(db.map((r) => [r.application_number, r]));
const { rows: crit } = await pool.query('SELECT * FROM cluster_eval_criteria');
const { rows: elig } = await pool.query('SELECT * FROM cluster_eval_eligibility');
const critKey = new Map(crit.map((c) => [`${c.application_number}|${c.code}`, c]));
const eligKey = new Map(elig.map((e) => [`${e.application_number}|${e.test}`, e]));

// ── SCORECARD by cell address ──
// C app; sub-indicators I-N (C1), R-W (C2), AA-AC (C3), AG-AH (C4), AL-AM (C5), AQ-AS (C6)
// criterion rating / weighted: O/P, X/Y, AD/AE, AI/AJ, AN/AO, AT/AU; AY total; AZ band; BC moderation; BE expert remarks
const subs = {
  C1: ['I', 'J', 'K', 'L', 'M', 'N'], C2: ['R', 'S', 'T', 'U', 'V', 'W'], C3: ['AA', 'AB', 'AC'], C4: ['AG', 'AH'], C5: ['AL', 'AM'], C6: ['AQ', 'AR', 'AS'],
};
const critCols = { c1: ['O', 'P'], c2: ['X', 'Y'], c3: ['AD', 'AE'], c4: ['AI', 'AJ'], c5: ['AN', 'AO'], c6: ['AT', 'AU'] };
const evCols = { c1: 'Q', c2: 'Z', c3: 'AF', c4: 'AK', c5: 'AP', c6: 'AV' };
const sheetScores = [];
let n = 0;
for (let r = 6; r <= 120; r++) {
  const app = norm(cell('SCORECARD', `C${r}`));
  if (!app.startsWith('KJET-')) continue;
  n++;
  const d = byApp.get(app);
  check(`${app} stored`, !!d);
  if (!d) continue;
  const total = Number(cell('SCORECARD', `AY${r}`));
  check(`${app} total_score`, close(total, d.total_score), `${total} vs ${d.total_score}`);
  check(`${app} band`, norm(cell('SCORECARD', `AZ${r}`)) === norm(d.band), `${cell('SCORECARD', `AZ${r}`)} vs ${d.band}`);
  check(`${app} eligibility (scorecard)`, norm(cell('SCORECARD', `H${r}`)) === norm(d.eligibility));
  check(`${app} moderation note`, norm(cell('SCORECARD', `BC${r}`)) === norm(d.moderation_note));
  check(`${app} expert remarks`, norm(cell('SCORECARD', `BE${r}`)) === norm(d.expert_remarks));
  for (const [k, [rc, wc]] of Object.entries(critCols)) {
    check(`${app} ${k}_rating`, close(cell('SCORECARD', `${rc}${r}`), d[`${k}_rating`]));
    check(`${app} ${k}_score`, close(cell('SCORECARD', `${wc}${r}`), d[`${k}_score`]));
    check(`${app} ${k}_evidence`, norm(cell('SCORECARD', `${evCols[k]}${r}`)) === norm(d[`${k}_evidence`]));
  }
  for (const [c, cols] of Object.entries(subs)) {
    cols.forEach((col, i) => {
      const code = `${c}.${i + 1}`;
      const row = critKey.get(`${app}|${code}`);
      check(`${app} ${code} rating`, !!row && close(cell('SCORECARD', `${col}${r}`), row.rating), `${cell('SCORECARD', `${col}${r}`)} vs ${row?.rating}`);
    });
  }
  sheetScores.push({ app, total, c1: Number(cell('SCORECARD', `P${r}`)), c2: Number(cell('SCORECARD', `Y${r}`)), c6: Number(cell('SCORECARD', `AU${r}`)), elig: norm(cell('SCORECARD', `H${r}`)) });
}
check('85 clusters in the sheet', n === 85, String(n));
check('85 clusters stored', db.length === 85, String(db.length));
check('22 ratings per cluster', crit.length === 85 * 22, String(crit.length));
check('10 eligibility tests per cluster', elig.length === 850, String(elig.length));

// ── Eligibility by cell address: B app; hints H,J,L,...,Z; decisions I,K,M,...,AA; AC status; AD reasons; AE evidence ──
const hintCols = ['H', 'J', 'L', 'N', 'P', 'R', 'T', 'V', 'X', 'Z'];
const decCols = ['I', 'K', 'M', 'O', 'Q', 'S', 'U', 'W', 'Y', 'AA'];
for (let r = 6; r <= 120; r++) {
  const app = norm(cell('Eligibility', `B${r}`));
  if (!app.startsWith('KJET-')) continue;
  const d = byApp.get(app);
  if (!d) continue;
  check(`${app} eligibility status`, norm(cell('Eligibility', `AC${r}`)) === norm(d.eligibility), `${cell('Eligibility', `AC${r}`)} vs ${d.eligibility}`);
  check(`${app} eligibility reasons`, norm(cell('Eligibility', `AD${r}`)) === norm(d.eligibility_reasons));
  check(`${app} evidence ids`, norm(cell('Eligibility', `AE${r}`)) === norm(d.evidence_ids));
  decCols.forEach((col, i) => {
    const e = eligKey.get(`${app}|E${i + 1}`);
    check(`${app} E${i + 1} decision`, !!e && norm(cell('Eligibility', `${col}${r}`)) === norm(e.decision), `${cell('Eligibility', `${col}${r}`)} vs ${e?.decision}`);
    check(`${app} E${i + 1} hint`, !!e && norm(cell('Eligibility', `${hintCols[i]}${r}`)) === norm(e.hint));
  });
}

// ── Financial_Screening by cell address: B app; F machinery, G services, H total, I contribution, J grant, K section 5 budget; U category; V max eligible; Y shortfall; Z doc check; AE note; AF result; AG issues ──
// The stored figures are the ones the evaluation was made on; the dashboard's own screening must give the sheet's result on them, for all 85.
let compared = 0;
for (let r = 6; r <= 120; r++) {
  const app = norm(cell('Financial_Screening', `B${r}`));
  if (!app.startsWith('KJET-')) continue;
  const d = byApp.get(app);
  check(`${app} fs result (workbook)`, norm(cell('Financial_Screening', `AF${r}`)) === norm(d.financial_screening));
  check(`${app} fs doc check`, norm(cell('Financial_Screening', `Z${r}`)) === norm(d.fs_doc_check));
  check(`${app} fs issues`, norm(cell('Financial_Screening', `AG${r}`)) === norm(d.fs_issues));
  check(`${app} fs note`, norm(cell('Financial_Screening', `AE${r}`)) === norm(d.fs_note));
  const nz = (ref) => { const v = cell('Financial_Screening', ref); return v === '' ? null : Number(v); };
  check(`${app} stored total`, close(nz(`H${r}`), d.eval_total_cost), `${nz(`H${r}`)} vs ${d.eval_total_cost}`);
  check(`${app} stored contribution`, close(nz(`I${r}`), d.eval_contribution));
  check(`${app} stored grant`, close(nz(`J${r}`), d.eval_grant_requested));
  check(`${app} stored machinery`, close(nz(`F${r}`), d.eval_machinery));
  check(`${app} stored services`, close(nz(`G${r}`), d.eval_services));
  check(`${app} stored section 5 budget`, close(nz(`K${r}`), d.eval_s5_budget));
  const s = screenFinancials({ total: d.eval_total_cost, contribution: d.eval_contribution, grant: d.eval_grant_requested, machinery: d.eval_machinery, services: d.eval_services, s5: d.eval_s5_budget }, { docCheck: norm(cell('Financial_Screening', `Z${r}`)) || null });
  compared++;
  check(`${app} screening result`, s.result === norm(cell('Financial_Screening', `AF${r}`)), `${s.result} vs ${cell('Financial_Screening', `AF${r}`)}`);
  check(`${app} window`, s.category === WINDOW[norm(cell('Financial_Screening', `U${r}`))], `${s.category} vs ${cell('Financial_Screening', `U${r}`)}`);
  check(`${app} max eligible grant`, close(s.checks.max_eligible_grant, nz(`V${r}`)));
  check(`${app} cash shortfall`, close(s.checks.contribution_shortfall, nz(`Y${r}`)));
}
check('screening compared on all 85 clusters', compared === 85, String(compared));

// ── Ranks among eligible clusters, recomputed independently; no funding selection is stored ──
const eligible = sheetScores.filter((s) => s.elig === 'PASS').sort((a, b) => (b.total - a.total) || (b.c2 - a.c2) || (b.c1 - a.c1) || (b.c6 - a.c6));
eligible.forEach((s, i) => check(`${s.app} rank`, byApp.get(s.app).rank === i + 1, `${byApp.get(s.app).rank} vs ${i + 1}`));
check('not-eligible clusters are not ranked', db.filter((d) => d.eligibility !== 'PASS').every((d) => d.rank == null));
check('no cluster is marked as selected for funding', db.every((d) => !d.shortlisted && d.shortlist_rank == null));

// ── The named primary assessor and expert reviewer, as the report says the dashboard publishes them ──
for (let r = 6; r <= 120; r++) {
  const app = norm(cell('SCORECARD', `C${r}`));
  if (!app.startsWith('KJET-')) continue;
  const d = byApp.get(app);
  check(`${app} primary assessor`, norm(cell('SCORECARD', `BA${r}`)) === norm(d.assessor), `${cell('SCORECARD', `BA${r}`)} vs ${d.assessor}`);
  check(`${app} expert reviewer`, norm(cell('SCORECARD', `BD${r}`)) === norm(d.reviewer), `${cell('SCORECARD', `BD${r}`)} vs ${d.reviewer}`);
}

console.log(`\nEvaluation check: ${passed} passed, ${failed} failed (${compared} clusters re-screened from the evaluation figures)`);
await pool.end();
process.exit(failed ? 1 : 0);
