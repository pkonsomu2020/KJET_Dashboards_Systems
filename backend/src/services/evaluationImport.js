/**
 * evaluationImport.js
 *
 * Loads the scoring results from the KJET Co-Investment Evaluation Tool (Excel workbook) into
 * PostgreSQL. This is a SEPARATE dataset from the Drive-synced applications: it holds what the
 * evaluators decided, stamped with the workbook it came from. It never changes application data.
 *
 * The workbook's calculated values are read (formulas are not re-run). Re-run the import whenever
 * the workbook is updated; it replaces the previous evaluation in one transaction.
 *
 * Sheets used: Final_Decision (gates, recommendations, grants), SCORECARD (criteria scores and
 * justifications), Grant Ready Clusters (the shortlist and the reason for each).
 */
import { createRequire } from 'module';
import { basename } from 'path';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

export async function ensureEvaluationSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS cluster_evaluation (
      application_number   VARCHAR(30) PRIMARY KEY REFERENCES clusters(application_number) ON DELETE CASCADE,
      source_file          TEXT,
      imported_at          TIMESTAMPTZ DEFAULT NOW(),

      eval_county          TEXT,
      eval_value_chain     TEXT,
      category             TEXT,
      eval_total_cost      NUMERIC,
      eval_grant_requested NUMERIC,
      max_eligible_grant   NUMERIC,

      financial_screening  TEXT,
      data_readiness       TEXT,
      eligibility          TEXT,
      due_diligence        TEXT,
      exclusion_status     TEXT,
      es_disposition       TEXT,

      system_recommendation TEXT,
      conditions           TEXT,
      technical_rec        TEXT,
      msea_decision        TEXT,
      approved_grant       NUMERIC,
      wb_status            TEXT,

      total_score          NUMERIC,
      band                 TEXT,
      rank                 INTEGER,
      county_rank          INTEGER,
      c1_rating NUMERIC, c1_score NUMERIC, c1_evidence TEXT,
      c2_rating NUMERIC, c2_score NUMERIC, c2_evidence TEXT,
      c3_rating NUMERIC, c3_score NUMERIC, c3_evidence TEXT,
      c4_rating NUMERIC, c4_score NUMERIC, c4_evidence TEXT,
      c5_rating NUMERIC, c5_score NUMERIC, c5_evidence TEXT,
      c6_rating NUMERIC, c6_score NUMERIC, c6_evidence TEXT,
      assessor             TEXT,
      reviewer             TEXT,

      shortlisted          BOOLEAN DEFAULT FALSE,
      shortlist_rank       INTEGER,
      shortlist_reason     TEXT
    )`);
  await db.query('CREATE INDEX IF NOT EXISTS idx_cluster_evaluation_score ON cluster_evaluation(total_score DESC)');
  await db.query('CREATE INDEX IF NOT EXISTS idx_cluster_evaluation_shortlist ON cluster_evaluation(shortlisted, shortlist_rank)');
}

const clean = (v) => {
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').replace(/\s+/g, ' ').trim();
  return s === '' ? null : s;
};
const numOrNull = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const intOrNull = (v) => { const n = numOrNull(v); return n == null ? null : Math.round(n); };

function sheetRows(wb, name) {
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(`Sheet "${name}" not found in the workbook`);
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
}

/** Column index by header text (prefix match, whitespace-insensitive). */
function columnFinder(headerRow, sheet) {
  const heads = headerRow.map((h) => String(h).replace(/\s+/g, ' ').trim());
  return (name) => {
    const i = heads.findIndex((h) => h.startsWith(name));
    if (i < 0) throw new Error(`Column "${name}" not found in sheet ${sheet}: has the workbook layout changed?`);
    return i;
  };
}

/** Reads and validates the workbook. Returns { rows, shortlistedCount, sourceFile }. */
export function readEvaluationWorkbook(path) {
  // cellDates stays off: some score cells (e.g. C4 weighted) carry a date number format in Excel but hold plain numbers
  const wb = XLSX.readFile(path, { cellDates: false });

  // Final_Decision: header on row 5
  const fd = sheetRows(wb, 'Final_Decision');
  const f = columnFinder(fd[4], 'Final_Decision');
  const col = Object.fromEntries([
    'Application No.', 'County', 'Value chain', 'Category', 'Total project cost', 'KJET grant requested', 'Maximum eligible grant',
    'Financial screening', 'Data readiness', 'Eligibility', 'Total score', 'Band', 'Rank', 'County rank', 'Due diligence',
    'Exclusion status', 'E&S disposition', 'SYSTEM RECOMMENDATION', 'Conditions attached', 'Leadedge technical rec',
    'MSEA evaluation decisi', 'Approved KJET grant', 'World Bank status',
  ].map((n) => [n, f(n)]));

  // SCORECARD: header on row 5; criterion columns found by their header
  const sc = sheetRows(wb, 'SCORECARD');
  const s = columnFinder(sc[4], 'SCORECARD');
  const scCol = {
    app: s('Application No.'), total: s('TOTAL SCORE'),
    assessor: s('Primary assessor'), reviewer: s('Independent reviewer'),
  };
  for (let c = 1; c <= 6; c++) {
    scCol[`c${c}r`] = s(`C${c} rating`);
    scCol[`c${c}s`] = s(`C${c} weighted`);
    scCol[`c${c}e`] = s(`C${c} evidence`);
  }
  const scoreByApp = new Map(sc.slice(5).filter((r) => String(r[scCol.app]).startsWith('KJET-')).map((r) => [String(r[scCol.app]).trim(), r]));

  // Grant Ready Clusters: header on row 3
  const gr = sheetRows(wb, 'Grant Ready Clusters');
  const shortlist = new Map();
  for (const r of gr) {
    if (String(r[1]).startsWith('KJET-')) shortlist.set(String(r[1]).trim(), { rank: intOrNull(r[0]), reason: clean(r[7]) });
  }

  const rows = [];
  for (const r of fd.slice(5)) {
    const app = String(r[col['Application No.']]).trim();
    if (!app.startsWith('KJET-')) continue;
    const sr = scoreByApp.get(app);
    const sl = shortlist.get(app);
    const row = {
      application_number: app,
      eval_county: clean(r[col.County]), eval_value_chain: clean(r[col['Value chain']]), category: clean(r[col.Category]),
      eval_total_cost: numOrNull(r[col['Total project cost']]), eval_grant_requested: numOrNull(r[col['KJET grant requested']]),
      max_eligible_grant: numOrNull(r[col['Maximum eligible grant']]),
      financial_screening: clean(r[col['Financial screening']]), data_readiness: clean(r[col['Data readiness']]),
      eligibility: clean(r[col.Eligibility]), due_diligence: clean(r[col['Due diligence']]),
      exclusion_status: clean(r[col['Exclusion status']]), es_disposition: clean(r[col['E&S disposition']]),
      system_recommendation: clean(r[col['SYSTEM RECOMMENDATION']]), conditions: clean(r[col['Conditions attached']]),
      technical_rec: clean(r[col['Leadedge technical rec']]), msea_decision: clean(r[col['MSEA evaluation decisi']]),
      approved_grant: numOrNull(r[col['Approved KJET grant']]), wb_status: clean(r[col['World Bank status']]),
      total_score: numOrNull(r[col['Total score']]), band: clean(r[col.Band]),
      rank: intOrNull(r[col.Rank]), county_rank: intOrNull(r[col['County rank']]),
      assessor: sr ? clean(sr[scCol.assessor]) : null, reviewer: sr ? clean(sr[scCol.reviewer]) : null,
      shortlisted: !!sl, shortlist_rank: sl?.rank ?? null, shortlist_reason: sl?.reason ?? null,
    };
    for (let c = 1; c <= 6; c++) {
      row[`c${c}_rating`] = sr ? numOrNull(sr[scCol[`c${c}r`]]) : null;
      row[`c${c}_score`] = sr ? numOrNull(sr[scCol[`c${c}s`]]) : null;
      row[`c${c}_evidence`] = sr ? clean(sr[scCol[`c${c}e`]]) : null;
    }
    rows.push(row);
  }
  for (const app of shortlist.keys()) {
    if (!rows.some((r) => r.application_number === app)) throw new Error(`Shortlisted cluster ${app} is missing from Final_Decision`);
  }
  return { rows, shortlistedCount: shortlist.size, sourceFile: basename(path) };
}

/** Replaces the stored evaluation with the workbook's. One transaction; all-or-nothing. */
export async function importEvaluation(pool, path) {
  const { rows, shortlistedCount, sourceFile } = readEvaluationWorkbook(path);
  const { rows: known } = await pool.query('SELECT application_number FROM clusters');
  const have = new Set(known.map((k) => k.application_number));
  const unknown = rows.filter((r) => !have.has(r.application_number)).map((r) => r.application_number);
  if (unknown.length) throw new Error(`Workbook clusters not in the database: ${unknown.join(', ')}`);

  const client = await pool.connect();
  try {
    await ensureEvaluationSchema(client);
    await client.query('BEGIN');
    await client.query('DELETE FROM cluster_evaluation');
    for (const r of rows) {
      const cols = Object.keys(r);
      await client.query(
        `INSERT INTO cluster_evaluation (source_file, ${cols.join(', ')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})`,
        [sourceFile, ...cols.map((c) => r[c])],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return { imported: rows.length, shortlisted: shortlistedCount, sourceFile };
}
