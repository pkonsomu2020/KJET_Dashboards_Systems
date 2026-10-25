/**
 * evaluationImport.js
 *
 * Loads the evaluation (the KJET Co-Investment Evaluation Tool) into PostgreSQL: scores, band,
 * ratings and justifications (SCORECARD), the ten eligibility tests (Eligibility) and the evaluator's
 * screening findings (Financial_Screening). This is a SEPARATE dataset from the Drive-synced
 * applications; it never changes application data and never stores amounts.
 *
 * The normal source is the online Google Sheet (see evaluationSheet.js); a downloaded .xlsx can also
 * be loaded with scripts/import-evaluation.js. Calculated values are read (formulas are not re-run).
 * Each import replaces the previous evaluation in one transaction.
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
  // Evaluator findings from the Eligibility and Financial_Screening tabs (amounts are never stored: they come from Drive)
  await db.query(`
    ALTER TABLE cluster_evaluation
      ADD COLUMN IF NOT EXISTS eligibility_reasons TEXT,
      ADD COLUMN IF NOT EXISTS evidence_ids        TEXT,
      ADD COLUMN IF NOT EXISTS fs_doc_check       TEXT,
      ADD COLUMN IF NOT EXISTS fs_issues          TEXT,
      ADD COLUMN IF NOT EXISTS fs_note            TEXT,
      ADD COLUMN IF NOT EXISTS fs_category        TEXT,
      ADD COLUMN IF NOT EXISTS expert_remarks     TEXT,
      ADD COLUMN IF NOT EXISTS moderation_note    TEXT`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS cluster_eval_criteria (
      application_number VARCHAR(30) NOT NULL REFERENCES clusters(application_number) ON DELETE CASCADE,
      code      VARCHAR(8) NOT NULL,
      criterion VARCHAR(4) NOT NULL,
      label     TEXT,
      weight    NUMERIC,
      rating    NUMERIC,
      PRIMARY KEY (application_number, code)
    )`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS cluster_eval_eligibility (
      application_number VARCHAR(30) NOT NULL REFERENCES clusters(application_number) ON DELETE CASCADE,
      test     VARCHAR(4) NOT NULL,
      label    TEXT,
      hint     TEXT,
      decision TEXT,
      PRIMARY KEY (application_number, test)
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

/** Reads a workbook from disk (cellDates stays off: some score cells carry a date number format but hold plain numbers). */
export function readEvaluationWorkbook(path) {
  return parseEvaluationWorkbook(XLSX.readFile(path, { cellDates: false }), basename(path));
}

/** Reads a workbook held in memory, for example the online Google Sheet exported as .xlsx. */
export function readEvaluationBuffer(buffer, sourceFile) {
  return parseEvaluationWorkbook(XLSX.read(buffer, { type: 'buffer', cellDates: false }), sourceFile);
}

/**
 * Validates the workbook. Returns { rows, criteria, eligibility, sourceFile }.
 *
 * Built on three tabs: SCORECARD (ratings, scores, band, justifications, expert remarks), Eligibility
 * (E1-E10 and the status) and Financial_Screening (the evaluator's findings). Nothing is taken from
 * Final_Decision: it only repeats these tabs and breaks when columns move. Ranks among the
 * eligible clusters are worked out here from the scores. Selecting clusters for funding is a decision
 * for MSEA and is not made here. Names of assessors and reviewers are not read.
 */
function parseEvaluationWorkbook(wb, sourceFile) {
  // ── SCORECARD (header on row 5) ──
  const sc = sheetRows(wb, 'SCORECARD');
  const s = columnFinder(sc[4], 'SCORECARD');
  const scCol = {
    app: s('Application No.'), category: s('Category'), elig: s('Eligibility status'), total: s('TOTAL SCORE'), band: s('Decision band'),
    moderation: s('Moderation note'),
  };
  const optional = (name) => { try { return s(name); } catch { return -1; } };
  scCol.expertRemarks = optional('Expert remarks');
  for (let c = 1; c <= 6; c++) {
    scCol[`c${c}r`] = s(`C${c} rating`);
    scCol[`c${c}s`] = s(`C${c} weighted`);
    scCol[`c${c}e`] = s(`C${c} evidence`);
  }
  const scoreRows = sc.slice(5).filter((r) => String(r[scCol.app]).startsWith('KJET-'));
  if (scoreRows.length === 0) throw new Error('SCORECARD has no clusters');

  // the 22 sub-indicator ratings (header "C1.1 Legal standing and governance (15%)")
  const subCols = sc[4].map((h, i) => {
    const m = String(h).replace(/\s+/g, ' ').trim().match(/^(C([1-6])\.(\d)) (.+?) \((\d+)%\)$/);
    return m ? { i, code: m[1], criterion: `C${m[2]}`, label: m[4], weight: Number(m[5]) } : null;
  }).filter(Boolean);
  if (subCols.length !== 22) throw new Error(`SCORECARD: expected 22 sub-indicator columns, found ${subCols.length}`);

  // ── Eligibility: E1-E10 system hint + decision, the status, the reasons and the evidence ids ──
  const el = sheetRows(wb, 'Eligibility');
  const eh = el[4].map((h) => String(h).replace(/\s+/g, ' ').trim());
  const e = columnFinder(el[4], 'Eligibility');
  const eTests = [];
  for (let n = 1; n <= 10; n++) {
    const hi = eh.findIndex((h) => new RegExp(`^E${n} – .+ – system hint$`).test(h));
    const di = eh.findIndex((h) => h === `E${n} decision`);
    if (hi < 0 || di < 0) throw new Error(`Eligibility: columns for test E${n} not found: has the workbook layout changed?`);
    eTests.push({ n, test: `E${n}`, label: eh[hi].replace(/^E\d+ – /, '').replace(/ – system hint$/, ''), hint: hi, decision: di });
  }
  const elCol = { app: e('Application No.'), reasons: e('Reasons for Fail / Hold'), evidence: e('Evidence IDs') };
  const eligByApp = new Map(el.slice(5).filter((r) => String(r[elCol.app]).startsWith('KJET-')).map((r) => [String(r[elCol.app]).trim(), r]));

  // ── Financial_Screening: the evaluator's findings (result, category, document check, issues, note); amounts come from Drive ──
  const fsr = sheetRows(wb, 'Financial_Screening');
  const fc = columnFinder(fsr[4], 'Financial_Screening');
  const fsCol = {
    app: fc('Application No.'), cat: fc('Category (by KJET request)'), docs: fc('Category document check'), note: fc('Note (Evaluation'),
    issues: fc('Issues identified'), result: fc('FINANCIAL SCREENING RESULT'),
  };
  const fsByApp = new Map(fsr.slice(5).filter((r) => String(r[fsCol.app]).startsWith('KJET-')).map((r) => [String(r[fsCol.app]).trim(), r]));

  // ── Parameters: the score a cluster needs to be Recommended ──
  const par = sheetRows(wb, 'Parameters');
  const prow = par.find((r) => r.some((c) => String(c).startsWith('Recommended – minimum score')));
  const pcol = prow ? prow.findIndex((c) => String(c).startsWith('Recommended – minimum score')) : -1;
  const minScore = prow ? numOrNull(prow[pcol + 1]) : null;
  if (minScore == null) throw new Error('Parameters: "Recommended – minimum score" not found: has the workbook layout changed?');

  const rows = [];
  const criteria = [];
  const eligibility = [];
  for (const sr of scoreRows) {
    const app = String(sr[scCol.app]).trim();
    const er = eligByApp.get(app);
    const fr = fsByApp.get(app);
    const row = {
      application_number: app,
      category: clean(sr[scCol.category]),
      financial_screening: fr ? clean(fr[fsCol.result]) : null,
      eligibility: clean(sr[scCol.elig]) ?? (er ? clean(er[e('ELIGIBILITY STATUS')]) : null),
      total_score: numOrNull(sr[scCol.total]), band: clean(sr[scCol.band]),
      expert_remarks: scCol.expertRemarks >= 0 ? clean(sr[scCol.expertRemarks]) : null,
      moderation_note: clean(sr[scCol.moderation]),
      eligibility_reasons: er ? clean(er[elCol.reasons]) : null,
      evidence_ids: er ? clean(er[elCol.evidence]) : null,
      fs_doc_check: fr ? clean(fr[fsCol.docs]) : null,
      fs_issues: fr ? clean(fr[fsCol.issues]) : null,
      fs_note: fr ? clean(fr[fsCol.note]) : null,
      fs_category: fr ? clean(fr[fsCol.cat]) : null,
    };
    for (let c = 1; c <= 6; c++) {
      row[`c${c}_rating`] = numOrNull(sr[scCol[`c${c}r`]]);
      row[`c${c}_score`] = numOrNull(sr[scCol[`c${c}s`]]);
      row[`c${c}_evidence`] = clean(sr[scCol[`c${c}e`]]);
    }
    for (const sc2 of subCols) criteria.push({ application_number: app, code: sc2.code, criterion: sc2.criterion, label: sc2.label, weight: sc2.weight, rating: numOrNull(sr[sc2.i]) });
    if (er) for (const t of eTests) eligibility.push({ application_number: app, test: t.test, label: t.label, hint: clean(er[t.hint]), decision: clean(er[t.decision]) });
    rows.push(row);
  }

  // Ranks among eligible (PASS) clusters; ties broken by C2, then C1, then C6 weighted score (the workbook's tie-break order)
  const byMerit = (a, b) => (b.total_score - a.total_score) || (b.c2_score - a.c2_score) || (b.c1_score - a.c1_score) || (b.c6_score - a.c6_score);
  const eligible = rows.filter((r) => r.eligibility === 'PASS' && r.total_score != null).sort(byMerit);
  eligible.forEach((r, i) => { r.rank = i + 1; });
  const seenInCounty = new Map();
  const countyOf = new Map(scoreRows.map((r) => [String(r[scCol.app]).trim(), clean(r[s('County')])]));
  for (const r of eligible) {
    const k = countyOf.get(r.application_number);
    seenInCounty.set(k, (seenInCounty.get(k) ?? 0) + 1);
    r.county_rank = seenInCounty.get(k);
  }
  return { rows, criteria, eligibility, sourceFile, minScore };
}

/** Replaces the stored evaluation with the workbook's. One transaction; all-or-nothing. */
export async function importEvaluation(pool, source) {
  // source: a path to an .xlsx, or { buffer, name } for a workbook already in memory
  const { rows, criteria, eligibility, sourceFile } =
    typeof source === 'string' ? readEvaluationWorkbook(source) : readEvaluationBuffer(source.buffer, source.name);
  const { rows: known } = await pool.query('SELECT application_number FROM clusters');
  const have = new Set(known.map((k) => k.application_number));
  const unknown = rows.filter((r) => !have.has(r.application_number)).map((r) => r.application_number);
  if (unknown.length) throw new Error(`Workbook clusters not in the database: ${unknown.join(', ')}`);

  const client = await pool.connect();
  try {
    await ensureEvaluationSchema(client);
    await client.query('BEGIN');
    await client.query('DELETE FROM cluster_eval_criteria');
    await client.query('DELETE FROM cluster_eval_eligibility');
    await client.query('DELETE FROM cluster_evaluation');
    for (const r of rows) {
      const cols = Object.keys(r);
      await client.query(
        `INSERT INTO cluster_evaluation (source_file, ${cols.join(', ')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})`,
        [sourceFile, ...cols.map((c) => r[c])],
      );
    }
    for (const c of criteria) {
      await client.query('INSERT INTO cluster_eval_criteria (application_number, code, criterion, label, weight, rating) VALUES ($1,$2,$3,$4,$5,$6)',
        [c.application_number, c.code, c.criterion, c.label, c.weight, c.rating]);
    }
    for (const t of eligibility) {
      await client.query('INSERT INTO cluster_eval_eligibility (application_number, test, label, hint, decision) VALUES ($1,$2,$3,$4,$5)',
        [t.application_number, t.test, t.label, t.hint, t.decision]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return { imported: rows.length, criteria: criteria.length, eligibility: eligibility.length, sourceFile };
}
