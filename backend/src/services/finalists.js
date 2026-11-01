/**
 * finalists.js
 *
 * The finalists of each cohort: the clusters shortlisted from all applications
 * (Cohort 1: the top 2 in each county; Cohort 2: the top 6 in each county).
 *
 *   - their selection scores come from the cohort's online Google Sheet (Cohort 1: tab TOP2-OP, Cohort 2: tab Selected),
 *     re-read every 15 seconds like the co-investment evaluation sheet. Cluster names come from the sheet itself
 *     (Cohort 1: the Master List tab; Cohort 2: the Final Contact Info tab);
 *   - their application forms and documents come from the cohort's bundle folder on disk (one folder per finalist),
 *     read by importBundles(). The finance questions of the form are never stored. A folder is only used when its own
 *     application form is for that finalist: a folder that holds another cluster's application is reported and shows nothing.
 *
 * A finalist is identified by its key: the sheet's Application ID without the word "Applicant" ("297", "KJET-20251229171110-PYGB").
 *
 * Needs the Drive service account (the sheet must be shared with it).
 */
import { createRequire } from 'module';
import AdmZip from 'adm-zip';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join, resolve, sep } from 'path';
import { fileURLToPath } from 'url';
import pool from '../db/pool.js';
import { cacheInvalidate } from '../cache/redis.js';
import { getDriveClient } from './driveService.js';
import { finalizeForm, finalizePlatform, listDocuments, readFormPdf, summariseForm, withoutFinance, wrappedLines } from './finalistForm.js';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const here = dirname(fileURLToPath(import.meta.url));

/** Where each cohort's finalists are kept. The ids are not secret; they can be overridden from the environment. */
export const COHORTS = {
  1: {
    layout: 'c1',
    sheetId: process.env.FINALISTS_C1_SHEET_ID || '1gKzmfig5PFcUD_0ymvN_1U5Q0qZHXorn9M710qObxNQ',
    tab: 'TOP2-OP',
    gid: process.env.FINALISTS_C1_GID || '2060887558',
    masterTab: 'Master List',
    // the tabs that carry each applicant's Google Drive link (the finalist tab itself only has the file name as plain text)
    linkTabs: ['ALL SCORED', 'ONLY PASS'],
    idCell: /^(applicant|application|appliacant)[\s_]*\d+$/i,
    bundlesDir: resolve(process.env.FINALISTS_C1_BUNDLES_DIR || join(here, '../../../COHORT_1_FINALISTS_BUNDLES')),
  },
  2: {
    layout: 'c2',
    sheetId: process.env.FINALISTS_C2_SHEET_ID || '1sIaLK5ro1jvcFUrBxx5zhrPSqkNtKIxJCdHmBOPG_pA',
    tab: 'Selected',
    gid: process.env.FINALISTS_C2_GID || '1246102272',
    contactTab: 'Final Contact Info',   // names, constituency, ward, phone and e-mail of each finalist
    rulesTab: 'Evaluation',             // the headings that state the eligibility rule
    // the Selected tab carries the Drive link of each finalist; 16 of its links open another cluster's bundle, and the Evaluation (and a few other)
    // tabs carry the right link for the same finalist, so they follow as fall-backs (each link is checked against Drive's own name for it)
    linkTabs: ['Selected', 'Evaluation', 'Final Contact Info', 'Reapplicants', 'C1 Alternates'],
    idCell: /^applicant[\s_]*\S+$/i,
    bundlesDir: resolve(process.env.FINALISTS_C2_BUNDLES_DIR || join(here, '../../../COHORT_2_FINALISTS_BUNDLES')),
  },
};

export const sheetRowLink = (c, row) => `https://docs.google.com/spreadsheets/d/${c.sheetId}/edit#gid=${c.gid}&range=A${row}`;

export async function ensureFinalistSchema(db = pool) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS finalists (
      cohort              SMALLINT NOT NULL,
      applicant_id        TEXT NOT NULL,
      application_id      TEXT,
      cluster_name        TEXT,
      application_number  TEXT,
      registration_number TEXT,
      registration_status TEXT,
      county              TEXT,
      constituency        TEXT,
      ward                TEXT,
      value_chain         TEXT,
      sheet_row           INT,
      checks              JSONB,
      result              TEXT,
      reason              TEXT,
      criteria            JSONB,
      disqualifier        TEXT,
      tier                TEXT,
      normalized          JSONB,
      weighted            JSONB,
      total               NUMERIC,
      penalty             NUMERIC,
      composite           NUMERIC,
      rank                INT,
      evaluator           TEXT,
      track_years         NUMERIC,
      rank_in_county      INT,
      drive_link          TEXT,
      drive_file          TEXT,
      imported_at         TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (cohort, applicant_id)
    );
    -- Cohort 1 kept its key as a number; Cohort 2 ids are text ("KJET-20251229171110-PYGB")
    ALTER TABLE finalists ALTER COLUMN applicant_id TYPE TEXT USING applicant_id::text;
    ALTER TABLE finalists ADD COLUMN IF NOT EXISTS application_id TEXT;
    ALTER TABLE finalists ADD COLUMN IF NOT EXISTS drive_link TEXT;
    ALTER TABLE finalists ADD COLUMN IF NOT EXISTS drive_file TEXT;
    ALTER TABLE finalists ADD COLUMN IF NOT EXISTS equity_points NUMERIC;
    ALTER TABLE finalists ADD COLUMN IF NOT EXISTS other_value_chain TEXT;
    ALTER TABLE finalists ADD COLUMN IF NOT EXISTS contact JSONB;
    ALTER TABLE finalists ADD COLUMN IF NOT EXISTS flags JSONB;
    CREATE TABLE IF NOT EXISTS finalist_meta (
      cohort SMALLINT PRIMARY KEY,
      rules  JSONB,
      imported_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS finalist_forms (
      cohort       SMALLINT NOT NULL,
      applicant_id TEXT NOT NULL,
      folder       TEXT,
      pages        INT,
      questions    JSONB,
      summary      JSONB,
      documents    JSONB,
      imported_at  TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (cohort, applicant_id)
    );
    ALTER TABLE finalist_forms ALTER COLUMN applicant_id TYPE TEXT USING applicant_id::text;
    ALTER TABLE finalist_forms ADD COLUMN IF NOT EXISTS status TEXT;
    ALTER TABLE finalist_forms ADD COLUMN IF NOT EXISTS kind TEXT;
    ALTER TABLE finalist_forms ADD COLUMN IF NOT EXISTS note TEXT;
    ALTER TABLE finalist_forms ADD COLUMN IF NOT EXISTS notes JSONB;
    ALTER TABLE finalist_forms ADD COLUMN IF NOT EXISTS missing_files JSONB;
  `);
}

// ── reading the sheet ──
const clean = (v) => { const s = String(v ?? '').replace(/\s+/g, ' ').trim(); return s === '' ? null : s; };
const numOrNull = (v) => { if (v === '' || v == null) return null; const n = Number(String(v).replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
const intOrNull = (v) => { const n = numOrNull(v); return n == null ? null : Math.round(n); };
const last4 = (s) => { const m = /(\d{4})$/.exec(String(s ?? '').trim()); return m ? Number(m[1]) : null; };
const norm = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * The finalist's key, from the sheet's Application ID. Cohort 1 writes it in several ways ("applicant 297", "Applicant_570", "Application 333",
 * "Appliacant_196"): the key is the number. Cohort 2 ids are text: the key is the id without the word "Applicant"
 * ("Applicant_KJET-20251229171110-PYGB" -> "KJET-20251229171110-PYGB", "Applicant_257" -> "257").
 */
export const keyOf = (cell, cohort = 2) => (COHORTS[cohort].layout === 'c1'
  ? (/(\d+)/.exec(String(cell ?? '')) ?? [])[1] ?? ''
  : String(cell ?? '').replace(/^applicant[\s_]*/i, '').trim());

/** The 47 counties by their official names; the sheets and folders spell some of them in several ways (Elgeiyo/Elgeyo, Homabay/Homa Bay). */
export const COUNTIES = ['Mombasa', 'Kwale', 'Kilifi', 'Tana River', 'Lamu', 'Taita Taveta', 'Garissa', 'Wajir', 'Mandera', 'Marsabit', 'Isiolo', 'Meru', 'Tharaka Nithi', 'Embu', 'Kitui',
  'Machakos', 'Makueni', 'Nyandarua', 'Nyeri', 'Kirinyaga', "Murang'a", 'Kiambu', 'Turkana', 'West Pokot', 'Samburu', 'Trans Nzoia', 'Uasin Gishu', 'Elgeyo Marakwet', 'Nandi', 'Baringo',
  'Laikipia', 'Nakuru', 'Narok', 'Kajiado', 'Kericho', 'Bomet', 'Kakamega', 'Vihiga', 'Bungoma', 'Busia', 'Siaya', 'Kisumu', 'Homa Bay', 'Migori', 'Kisii', 'Nyamira', 'Nairobi'];
const COUNTY_BY_KEY = new Map([...COUNTIES.map((c) => [norm(c), c]), [norm('Elgeiyo Marakwet'), 'Elgeyo Marakwet'], [norm('Tharaka-Nithi'), 'Tharaka Nithi']]);
export const canonicalCounty = (name) => COUNTY_BY_KEY.get(norm(name)) ?? null;

function gridOf(wb, name) {
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(`Sheet "${name}" not found in the workbook`);
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
}

const lines = (t) => String(t ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

/** Cohort 1: the finalist tab has its groups named on row 1 and its headings on row 2; names come from the Master List. */
function parseCohort1(wb, cohort) {
  const cfg = COHORTS[cohort];
  const top = gridOf(wb, cfg.tab);
  const head = top[1].map((h) => String(h).replace(/\s+/g, ' ').trim());
  const group = top[0].map((h) => String(h).replace(/\s+/g, ' ').trim());
  const col = (prefix) => {
    const i = head.findIndex((h) => h.startsWith(prefix));
    if (i < 0) throw new Error(`Column "${prefix}" not found in sheet ${cfg.tab}: has the layout changed?`);
    return i;
  };
  const c = {
    id: col('Application ID'), e1: col('E1.'), e2: col('E2.'), e3: col('E3.'), e4: col('E4.'), e5: col('E5.'),
    result: col('PASS/FAIL'), reason: col('REASON'), dq: col('DQ1'), tier: col('Tier 1'),
    total: col('TOTAL'), penalty: col('Penalty Points'), composite: col('Sum of weighted scores'), rank: col('Ranking from composite'),
    evaluator: col("Evaluator's Name"), years: col('TRACK_YEARS'), inCounty: col('RANK_IN_COUNTY'),
  };
  const nStart = group.findIndex((g) => g.startsWith('NORMALIZED SCORE'));
  const wStart = group.findIndex((g) => g.startsWith('WEIGHTED SCORING'));
  if (nStart < 0 || wStart < 0) throw new Error(`${cfg.tab}: the NORMALIZED SCORE or WEIGHTED SCORING columns were not found`);
  const items = [];
  head.forEach((h, i) => { const m = /^A3\.(\d) (.+)$/.exec(h); if (m) items.push({ code: `A3.${m[1]}`, label: m[2].trim(), at: i }); });
  if (items.length !== 6) throw new Error(`${cfg.tab}: expected six scoring items A3.1 to A3.6, found ${items.length}`);

  const master = gridOf(wb, cfg.masterTab);
  const mh = master[0].map((h) => String(h).trim());
  const mc = (name) => { const i = mh.indexOf(name); if (i < 0) throw new Error(`Master List: column "${name}" not found`); return i; };
  const m = { name: mc('Cluster Name'), app: mc('Application Number'), reg: mc('Registration Number'), status: mc('Registration Status'), county: mc('County'), constituency: mc('Constituency'), ward: mc('Ward') };
  const masterById = new Map();
  for (const r of master.slice(1)) {
    if (!String(r[m.name]).trim()) continue;
    const k = last4(r[m.app]);
    if (k != null) masterById.set(k, [...(masterById.get(k) ?? []), r]);
  }

  // the rules the sheet prints in its own headings, kept word for word
  const rawGroup = (prefix) => { const i = top[0].findIndex((g) => String(g).trim().startsWith(prefix)); return i < 0 ? '' : top[0][i]; };
  const rules = {
    eligibility: lines(rawGroup('Eligibility Criteria')).slice(1),                 // "Decision Box – Eligibility", "If any E1–E5 fails ...", "If all pass ..."
    disqualifiers: lines(top[1][c.dq]),                                           // DQ1, P1, P2
    tiers: lines(top[1][c.tier]),                                                  // Tier 1, Tier 2
    financial_evidence: lines(rawGroup('Scoring Rubrics')).filter((l) => /^(Evidence Box|Accept:)/i.test(l)),
  };

  const rows = [];
  const seen = new Set();
  top.slice(2).forEach((r, idx) => {
    if (!String(r[c.id]).trim()) return;
    const key = keyOf(r[c.id], cohort);
    const number = /^\d+$/.test(key) ? Number(key) : null;
    if (number == null) return;
    if (seen.has(key)) throw new Error(`${cfg.tab}: the Application ID ${r[c.id]} appears twice`);
    seen.add(key);
    // the sheet and the Master List both carry the applicant number: it is the key, the county confirms it
    const hits = masterById.get(number) ?? [];
    const mr = hits.find((h) => norm(h[m.county]) === norm(r[c.e2])) ?? hits[0] ?? null;
    rows.push({
      applicant_id: key,
      application_id: clean(r[c.id]),   // as the finalist sheet writes it ("applicant 297", "Applicant_570")
      cluster_name: mr ? clean(mr[m.name]) : null,
      application_number: mr ? clean(mr[m.app]) : null,
      registration_number: clean(r[c.e1]),
      registration_status: mr ? clean(mr[m.status]) : null,
      county: clean(r[c.e2]),
      constituency: mr ? clean(mr[m.constituency]) : null,
      ward: mr ? clean(mr[m.ward]) : null,
      value_chain: clean(r[c.e3]),
      sheet_row: idx + 3,   // two header rows, rows start at 1
      checks: { e1: clean(r[c.e1]), e2: clean(r[c.e2]), e3: clean(r[c.e3]), e4: clean(r[c.e4]), e5: clean(r[c.e5]) },
      result: clean(r[c.result]),
      reason: clean(r[c.reason]),
      criteria: items.map((it) => ({ code: it.code, label: it.label, rating: intOrNull(r[it.at]), logic: clean(r[it.at + 1]) })),
      disqualifier: clean(r[c.dq]),
      tier: clean(r[c.tier]),
      normalized: items.map((it, k) => ({ code: it.code, value: numOrNull(r[nStart + k]) })),
      weighted: items.map((it, k) => ({ code: it.code, value: numOrNull(r[wStart + k]) })),
      total: numOrNull(r[c.total]),
      penalty: numOrNull(r[c.penalty]),
      composite: numOrNull(r[c.composite]),
      rank: intOrNull(r[c.rank]),
      evaluator: clean(r[c.evaluator]),
      track_years: numOrNull(r[c.years]),
      rank_in_county: intOrNull(r[c.inCounty]),
    });
  });
  if (rows.length === 0) throw new Error(`${cfg.tab} has no finalists`);
  return { rows, rules };
}

/**
 * Cohort 2: the Selected tab has one heading row. It has no PASS/FAIL column (the tab lists the applicants who met the eligibility
 * criteria), its E1 column has no heading (it follows the Application ID), E4 and E5 are the evaluator's free-text notes, and it
 * has Equity Points. Names, constituency, ward and contacts come from the Final Contact Info tab, matched on the Application ID.
 */
function parseCohort2(wb, cohort) {
  const cfg = COHORTS[cohort];
  const sel = gridOf(wb, cfg.tab);
  const head = sel[0].map((h) => String(h).replace(/\s+/g, ' ').trim());
  const col = (prefix) => {
    const i = head.findIndex((h) => h.startsWith(prefix));
    if (i < 0) throw new Error(`Column "${prefix}" not found in sheet ${cfg.tab}: has the layout changed?`);
    return i;
  };
  const idCol = col('Application ID');
  if (head[idCol + 1] !== '') throw new Error(`${cfg.tab}: the column after Application ID (the registration number) should have no heading: has the layout changed?`);
  const c = {
    id: idCol, e1: idCol + 1, e2: col('E2.'), e3: col('E3.'), other: col('IF OTHER PVC'), e4: col('E4.'), e5: col('E5.'), reason: col('REASON'),
    dq: col('DQ1'), tier: col('Tier 1'), total: col('TOTAL'), equity: col('Equity Points'), penalty: col('Penalty Points'),
    composite: col('Sum of weighted scores'), rank: col('Ranking from composite'),
  };
  const items = [];
  head.forEach((h, i) => { const m = /^A3\.(\d) (.+)$/.exec(h); if (m) items.push({ code: `A3.${m[1]}`, label: m[2].trim(), at: i }); });
  if (items.length !== 6) throw new Error(`${cfg.tab}: expected six scoring items A3.1 to A3.6, found ${items.length}`);
  // the normalized scores and then the weighted scores are two runs of headings "A3.1" to "A3.6"
  const shorts = head.map((h, i) => (/^A3\.\d$/.test(h) ? i : -1)).filter((i) => i >= 0);
  if (shorts.length !== 12) throw new Error(`${cfg.tab}: expected 12 normalized and weighted score columns, found ${shorts.length}`);
  const nCols = shorts.slice(0, 6), wCols = shorts.slice(6);

  // Final Contact Info: names and contacts
  const fcRows = gridOf(wb, cfg.contactTab);
  const fh = fcRows[0].map((h) => String(h).trim());
  const fcol = (name) => { const i = fh.indexOf(name); if (i < 0) throw new Error(`${cfg.contactTab}: column "${name}" not found`); return i; };
  const f = { id: fcol('Application ID'), name: fcol('Cluster Name'), county: fcol('County'), constituency: fcol('Constituency'), ward: fcol('Ward'), vc: fcol('Value Chain'),
    phone: fcol('Contact'), alt: fcol('Alternate Contact'), email: fcol('Email address'), tier: fcol('Tiers'), score: fcol('Score') };
  const contact = new Map(fcRows.slice(1).filter((r) => String(r[f.id]).trim()).map((r) => [String(r[f.id]).trim(), r]));

  // the rules: the eligibility rule and the financial evidence the sheet accepts are printed in the Evaluation tab's group headings
  let rawGroup = () => '';
  try { const ev = gridOf(wb, cfg.rulesTab); rawGroup = (prefix) => { const i = ev[0].findIndex((g) => String(g).trim().startsWith(prefix)); return i < 0 ? '' : ev[0][i]; }; } catch { /* the Evaluation tab is only a source of wording */ }
  const rules = {
    eligibility: lines(rawGroup('Eligibility Criteria')).slice(1),
    disqualifiers: lines(sel[0][c.dq]),
    tiers: lines(sel[0][c.tier]),
    financial_evidence: lines(rawGroup('Scoring Rubrics')).filter((l) => /^(Evidence Box|Accept:)/i.test(l)),
  };

  const rows = [];
  const seen = new Set();
  sel.slice(1).forEach((r, idx) => {
    const idCell = String(r[c.id]).trim();
    if (!idCell) return;
    const key = keyOf(idCell, cohort);
    if (!key) return;
    if (seen.has(key)) throw new Error(`${cfg.tab}: the Application ID ${idCell} appears twice`);
    seen.add(key);
    const fc = contact.get(idCell) ?? null;
    const flags = [];
    const county = canonicalCounty(r[c.e2]) ?? clean(r[c.e2]);
    if (fc && (canonicalCounty(fc[f.county]) ?? clean(fc[f.county])) !== county) flags.push(`The Final Contact Info tab gives the county as ${clean(fc[f.county])}`);
    let tier = clean(r[c.tier]);
    if (!tier && fc && clean(fc[f.tier])) { tier = clean(fc[f.tier]); flags.push(`The tier is blank in the ${cfg.tab} tab; the ${cfg.contactTab} tab says ${tier}`); }
    const composite = numOrNull(r[c.composite]);
    if (fc && numOrNull(fc[f.score]) !== composite) flags.push(`The score in the ${cfg.contactTab} tab (${clean(fc[f.score])}) differs from the ${cfg.tab} tab (${composite})`);
    if (!fc) flags.push(`Not found in the ${cfg.contactTab} tab`);
    const vc = clean(r[c.e3]);
    rows.push({
      applicant_id: key,
      application_id: idCell,
      cluster_name: fc ? clean(fc[f.name]) : null,
      application_number: key.startsWith('KJET-') ? key : null,
      registration_number: clean(r[c.e1]),
      registration_status: null,   // the form states it
      county,
      constituency: fc ? clean(fc[f.constituency]) : null,
      ward: fc ? clean(fc[f.ward]) : null,
      value_chain: vc && /^other$/i.test(vc) ? 'Other' : vc,
      other_value_chain: clean(r[c.other]),
      sheet_row: idx + 2,   // one heading row
      checks: { e1: clean(r[c.e1]), e2: clean(r[c.e2]), e3: vc, e4: clean(r[c.e4]), e5: clean(r[c.e5]) },
      result: null,         // the Selected tab has no PASS/FAIL column
      reason: clean(r[c.reason]),
      criteria: items.map((it) => ({ code: it.code, label: it.label, rating: intOrNull(r[it.at]), logic: clean(r[it.at + 1]) })),
      disqualifier: clean(r[c.dq]),
      tier,
      normalized: items.map((it, k) => ({ code: it.code, value: numOrNull(r[nCols[k]]) })),
      weighted: items.map((it, k) => ({ code: it.code, value: numOrNull(r[wCols[k]]) })),
      total: numOrNull(r[c.total]),
      equity_points: numOrNull(r[c.equity]),
      penalty: numOrNull(r[c.penalty]),
      composite,
      rank: intOrNull(r[c.rank]),
      evaluator: null,
      track_years: null,
      rank_in_county: null,
      contact: fc ? { phone: clean(fc[f.phone]), alt_phone: clean(fc[f.alt]), email: clean(fc[f.email]) } : null,
      flags,
    });
  });
  if (rows.length === 0) throw new Error(`${cfg.tab} has no finalists`);
  return { rows, rules };
}

/** Parses a cohort's finalist tab (and the tabs that name them) into finalist rows and the rules the sheet prints. */
export function parseFinalistWorkbook(wb, cohort) {
  return COHORTS[cohort].layout === 'c2' ? parseCohort2(wb, cohort) : parseCohort1(wb, cohort);
}

// ── Google Drive links ──
// The spreadsheet shows each applicant's bundle as a file name; the link itself lives only in the Google Sheet's
// rich text, which the .xlsx export drops but the HTML export keeps. Each row is read as: the Drive link and file name in the
// first cell, and the Application ID ("Applicant_297") in another. A link is kept only when the file name carries that
// row's own applicant number or id ("application_297_bundle.zip", "application_KJET-20251229171110-PYGB_with_attachments...").
const stripTags = (h) => h.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&#39;|&#039;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

// A numeric key (every Cohort 1 finalist, and the Cohort 1 reapplicants in Cohort 2) is the number in "application_297_bundle.zip": it must be that number
// exactly, never a run of digits inside some other id. A Cohort 2 key ("KJET-20251229171110-PYGB") must appear whole in the file name.
const fileCarriesKey = (cohort, file, key) => (/^\d+$/.test(key)
  ? Number((/^application[\s_]*(\d+)_bundle/i.exec(file) ?? [])[1]) === Number(key)
  : file.toUpperCase().includes(key.toUpperCase()));

export function parseDriveLinks(html, cohort = 1) {
  const out = new Map();
  for (const row of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? []) {
    const anchor = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(row);
    if (!anchor) continue;
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => stripTags(m[1]));
    const idCell = cells.find((c) => COHORTS[cohort].idCell.test(c));
    if (!idCell) continue;
    const key = keyOf(idCell, cohort);
    const url = anchor[1].replace(/&amp;/g, '&');
    const file = stripTags(anchor[2]);
    if (!key || !/^https:\/\/drive\.google\.com\//.test(url) || !fileCarriesKey(cohort, file, key)) continue;   // not this applicant's bundle: no link
    if (!out.has(key)) out.set(key, { url, file });
  }
  return out;
}

/**
 * Reads the Drive links of one cohort's applicants from the sheet's HTML export: for each key, the links found on the link tabs,
 * best first (the order of linkTabs). The first tab can have a wrong link where another tab has the right one, so all are kept.
 */
export async function fetchDriveLinks(drive, cohort) {
  const cfg = COHORTS[cohort];
  const res = await drive.files.export({ fileId: cfg.sheetId, mimeType: 'application/zip' }, { responseType: 'arraybuffer' });
  const zip = new AdmZip(Buffer.from(res.data));
  const links = new Map();   // key -> [{ url, file, tab }]
  for (const tab of cfg.linkTabs) {
    const entry = zip.getEntry(`${tab}.html`);
    if (!entry) continue;
    for (const [key, l] of parseDriveLinks(entry.getData().toString('utf8'), cohort)) {
      const list = links.get(key) ?? [];
      if (!list.some((c) => driveItemId(c.url) === driveItemId(l.url))) list.push({ ...l, tab });
      links.set(key, list);
    }
  }
  return links;
}

// A link in the sheet can point at the wrong cluster's bundle (the text of the link says one thing, the file behind it is another).
// So each link is checked against what Drive itself calls the file or folder: only a link whose real name carries the finalist's own
// number or id is used. A link that cannot be checked because Drive did not answer is kept.
const driveItemId = (url) => (/\/(?:file\/d|drive\/folders)\/([^/?]+)/.exec(url) ?? /[?&]id=([^&]+)/.exec(url) ?? [])[1] ?? null;
const driveNames = new Map();   // Drive item id -> its name (null: not checkable); kept between syncs so only new links are asked about

export async function verifyDriveLinks(drive, links, cohort) {
  const wanted = [...new Set([...links.values()].flat().map((c) => driveItemId(c.url)).filter((id) => id && !driveNames.has(id)))];
  for (let i = 0; i < wanted.length; i += 8) {
    await Promise.all(wanted.slice(i, i + 8).map(async (id) => {
      try { driveNames.set(id, (await drive.files.get({ fileId: id, fields: 'name,trashed', supportsAllDrives: true })).data); } catch { driveNames.set(id, null); }
    }));
  }
  // for each finalist: the first link (in tab order) that really is its own bundle
  const chosen = new Map();     // key -> the link used
  const replaced = new Map();   // key -> { from: the wrong link that came first, to: the tab of the link used instead }
  const rejected = new Map();   // key -> the wrong links: none of the finalist's links is its own bundle
  for (const [key, candidates] of links) {
    const failures = [];
    for (const c of candidates) {
      const item = driveNames.get(driveItemId(c.url));
      if (!item || (!item.trashed && fileCarriesKey(cohort, item.name, key))) {   // Drive did not say: keep the link
        chosen.set(key, c);
        if (failures.length) replaced.set(key, { from: failures[0], to: c.tab });
        break;
      }
      failures.push({ tab: c.tab, name: item.trashed ? '(in the bin)' : item.name });
    }
    if (!chosen.has(key)) rejected.set(key, failures);
  }
  return { chosen, replaced, rejected };
}

const JSON_COLUMNS = new Set(['checks', 'criteria', 'normalized', 'weighted', 'contact', 'flags']);

/** One transaction: if the sheet is mid-edit or its layout is broken, the previous finalists stay in place. */
export async function importFinalists(cohort, { rows, rules, keepPreviousLinks = false }, db = pool) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const previous = new Map((await client.query('SELECT applicant_id, drive_link, drive_file FROM finalists WHERE cohort = $1', [cohort])).rows.map((r) => [r.applicant_id, r]));
    if (keepPreviousLinks) for (const r of rows) if (!r.drive_link && previous.get(r.applicant_id)?.drive_link) { r.drive_link = previous.get(r.applicant_id).drive_link; r.drive_file = previous.get(r.applicant_id).drive_file; }
    await client.query('DELETE FROM finalists WHERE cohort = $1', [cohort]);
    for (const r of rows) {
      const cols = Object.keys(r);
      await client.query(
        `INSERT INTO finalists (cohort, ${cols.join(', ')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})`,
        [cohort, ...cols.map((k) => (JSON_COLUMNS.has(k) ? JSON.stringify(r[k]) : r[k]))],
      );
    }
    if (rules) await client.query('INSERT INTO finalist_meta (cohort, rules, imported_at) VALUES ($1, $2, NOW()) ON CONFLICT (cohort) DO UPDATE SET rules = $2, imported_at = NOW()', [cohort, JSON.stringify(rules)]);
    await client.query('COMMIT');
    return rows.length;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── keeping the finalists in step with the online sheet ──
const status = {};
const settle = {};   // per cohort: modified time now imported, and a newer one waiting to settle
export const getFinalistSheetStatus = (cohort) => ({ ...(status[cohort] ?? { enabled: false }) });
let notifier = null;
export const setFinalistNotifier = (fn) => { notifier = fn; };

export async function syncFinalistSheet(cohort, { force = false } = {}) {
  const drive = getDriveClient();
  const cfg = COHORTS[cohort];
  const st = (status[cohort] ??= { enabled: false, sheet_name: null, sheet_modified: null, last_checked: null, last_imported: null, last_error: null, imported: null });
  const s = (settle[cohort] ??= { imported: null, pending: null, busy: false });
  if (!drive || !cfg || s.busy) return null;
  s.busy = true;
  try {
    const { data: meta } = await drive.files.get({ fileId: cfg.sheetId, fields: 'name,modifiedTime', supportsAllDrives: true });
    st.sheet_name = meta.name; st.sheet_modified = meta.modifiedTime; st.last_checked = new Date().toISOString();
    if (!force && meta.modifiedTime === s.imported) { s.pending = null; st.last_error = null; return null; }   // reached the sheet and nothing is new: an earlier failed check is over
    if (!force && s.pending !== meta.modifiedTime) { s.pending = meta.modifiedTime; return null; }   // wait for the edit to settle
    const res = await drive.files.export({ fileId: cfg.sheetId, mimeType: XLSX_MIME }, { responseType: 'arraybuffer' });
    const parsed = parseFinalistWorkbook(XLSX.read(Buffer.from(res.data), { type: 'buffer', cellDates: false }), cohort);
    const rows = parsed.rows;
    try {
      // the other tabs list every applicant, not only the finalists: only the finalists' links are looked at (and checked against Drive)
      const finalistKeys = new Set(rows.map((r) => r.applicant_id));
      const links = new Map([...(await fetchDriveLinks(drive, cohort))].filter(([key]) => finalistKeys.has(key)));
      const { chosen, replaced, rejected } = await verifyDriveLinks(drive, links, cohort);
      for (const r of rows) {
        const c = chosen.get(r.applicant_id);
        if (c) {
          r.drive_link = c.url; r.drive_file = c.file;
          const rp = replaced.get(r.applicant_id);
          if (rp) r.flags = [...(r.flags ?? []), `The ${rp.from.tab} tab's Drive link opens "${rp.from.name}", which is not this finalist's own bundle; the link from the ${c.tab} tab is used instead.`];
        } else if (rejected.has(r.applicant_id)) {
          r.flags = [...(r.flags ?? []), `The Drive link in the sheet opens "${rejected.get(r.applicant_id)[0]?.name}", which is not this finalist's own bundle, so no Drive link is shown.`];
        }
      }
      if (replaced.size) console.warn(`[Finalists] Cohort ${cohort}: ${replaced.size} finalist(s) have a wrong Drive link on the ${COHORTS[cohort].linkTabs[0]} tab; the right link from another tab is used:`, [...replaced.keys()].join(', '));
      if (rejected.size) console.warn(`[Finalists] Cohort ${cohort}: ${rejected.size} finalist(s) have only Drive links that open another cluster's bundle, so none is used:`, [...rejected.keys()].join(', '));
    } catch (err) { parsed.keepPreviousLinks = true; console.error(`[Finalists] Cohort ${cohort}: Drive links could not be read (earlier links kept):`, err.message); }
    const n = await importFinalists(cohort, parsed);
    await Promise.allSettled([cacheInvalidate(`finalists:${cohort}:*`)]);
    s.imported = meta.modifiedTime; s.pending = null;
    st.last_imported = new Date().toISOString(); st.last_error = null; st.imported = n;
    try { notifier?.(cohort); } catch { /* nobody listening */ }
    console.log(`[Finalists] Cohort ${cohort}: imported ${n} finalists from the online sheet, modified ${meta.modifiedTime}`);
    return n;
  } catch (err) {
    st.last_error = err.message;
    console.error(`[Finalists] Cohort ${cohort} sheet sync failed (previous finalists kept):`, err.message);
    return null;
  } finally {
    s.busy = false;
  }
}

export async function startFinalistSheetSync() {
  if (!getDriveClient()) { console.log('[Finalists] Sheet sync off (the Drive service account is not set up)'); return; }
  await ensureFinalistSchema();
  const every = Math.max(10, Number(process.env.EVALUATION_POLL_SECONDS) || 15) * 1000;
  for (const cohort of Object.keys(COHORTS)) {
    (status[cohort] ??= {}).enabled = true;
    await syncFinalistSheet(Number(cohort), { force: true });
    setInterval(() => { syncFinalistSheet(Number(cohort)); }, every).unref?.();
  }
  console.log(`[Finalists] Watching the finalist sheets every ${every / 1000}s`);
}

// ── the bundle folders: application forms and documents ──
const words = (s) => new Set(String(s ?? '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !['THE', 'AND', 'LTD', 'LIMITED', 'SOCIETY', 'COOPERATIVE', 'CO', 'OPERATIVE', 'COOP'].includes(w)));
const overlap = (a, b) => { const A = words(a), B = words(b); if (!A.size || !B.size) return 0; let n = 0; for (const w of A) if (B.has(w)) n++; return n / Math.min(A.size, B.size); };
const sameReg = (a, b) => { const x = norm(a).replace(/^0+/, ''), y = norm(b).replace(/^0+/, ''); return !!x && !!y && (x === y || x.includes(y) || y.includes(x)); };

/** The finalist's key a bundle folder stands for: Cohort 1 folders carry the applicant number; Cohort 2 folders are named by the Application ID. */
const folderKey = (cohort, folder) => (COHORTS[cohort].layout === 'c1' ? (/(\d+)/.exec(folder) ?? [])[1] ?? null : keyOf(folder, cohort) || null);

/** What a bundle's own MISSING_FILES_REPORT.txt says could not be found in storage: [{ type, count }]. */
function readMissingFiles(fdir) {
  const f = readdirSync(fdir).find((x) => /^MISSING_FILES_REPORT\.txt$/i.test(x));
  if (!f) return null;
  const counts = new Map();
  for (const m of readFileSync(join(fdir, f), 'utf8').matchAll(/File Type:\s*(.+)/g)) {
    const type = m[1].trim().replace(/^Supporting_Documents_/i, '').replace(/_/g, ' ');
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return [...counts.entries()].map(([type, count]) => ({ type, count }));
}

/**
 * Is the form in this folder this finalist's own? A new-platform form carries its application number; an older form carries its
 * Application ID (question 1), which must be the finalist's number. Anything else is another cluster's application.
 */
function identify(key, form, questions) {
  if (form.kind === 'platform') {
    const no = form.platformHeader.application_no;
    if (no && no.toUpperCase() === key.toUpperCase()) return { ok: true };
    return { ok: false, note: `The application form in this finalist's folder is for application ${no ?? 'unknown'} (${form.platformHeader.cluster ?? 'unnamed cluster'}), not for ${key}.` };
  }
  const id = questions.find((q) => q.n === 1)?.answer.trim();
  const name = questions.find((q) => /name of your cluster/i.test(q.question))?.answer.trim();
  if (/^\d+$/.test(key) && id === key) return { ok: true };
  return { ok: false, note: `The application form in this finalist's folder is for Application ID ${id ?? 'unknown'} (${name ?? 'unnamed cluster'}), not for ${key}.` };
}

/** Reads every finalist folder under the cohort's bundle directory. Safe to run again: it replaces what it read before. */
export async function importBundles(cohort, { dir, log = () => {} } = {}) {
  const cfg = COHORTS[cohort];
  const root = resolve(dir || cfg.bundlesDir);
  if (!existsSync(root)) throw new Error(`Bundle folder not found: ${root}`);
  await ensureFinalistSchema();
  let done = 0; const problems = []; const wrongApplication = [];
  const sheetRows = new Map((await pool.query('SELECT applicant_id, cluster_name, registration_number FROM finalists WHERE cohort = $1', [cohort])).rows.map((r) => [r.applicant_id, r]));

  // pass 1: read every form
  const found = [];
  for (const county of readdirSync(root)) {
    const cdir = join(root, county);
    if (!statSync(cdir).isDirectory()) continue;
    for (const folder of readdirSync(cdir)) {
      const fdir = join(cdir, folder);
      if (!statSync(fdir).isDirectory()) continue;
      const key = folderKey(cohort, folder);
      if (!key) { problems.push(`${county}/${folder}: no applicant number in the folder name`); continue; }
      const pdfs = readdirSync(fdir).filter((f) => /^application.*\.pdf$/i.test(f));
      const pdf = pdfs.find((f) => /^application_info/i.test(f)) ?? pdfs[0];
      if (!pdf) { problems.push(`${county}/${folder}: no application form PDF`); continue; }
      try { found.push({ county, folder, fdir, key, form: await readFormPdf(join(fdir, pdf)) }); } catch (err) { problems.push(`${county}/${folder}: ${err.message}`); }
    }
  }

  // pass 2: with all the forms in hand, work out how the older form's long questions wrap, then store each folder
  const wrapped = wrappedLines(found.filter((f) => f.form.kind === 'numbered').map((f) => f.form.raw));
  for (const { county, folder, fdir, key, form } of found) {
    try {
      const all = form.kind === 'platform' ? finalizePlatform(form.platformRaw) : finalizeForm(form.raw, wrapped);
      const who = identify(key, form, all);
      const base = [cohort, key, `${county}/${folder}`, form.pages];
      const missingFiles = readMissingFiles(fdir);
      let row;
      if (!who.ok) {
        // another cluster's application: nothing from this folder is shown, and it is reported
        wrongApplication.push(`${county}/${folder}: ${who.note}`);
        row = { questions: [], summary: null, documents: [], status: 'wrong_application', note: who.note, notes: [] };
      } else {
        const sheet = sheetRows.get(key);
        const notes = [];
        const formName = all.find((q) => /name of your cluster/i.test(q.question))?.answer;
        if (sheet?.cluster_name && formName && overlap(formName, sheet.cluster_name) < 0.5) notes.push(`The form gives the cluster name as "${formName}"; the spreadsheet has "${sheet.cluster_name}".`);
        if (form.kind === 'platform' && form.platformMissing.length) notes.push(`${form.platformMissing.length} question(s) of the form could not be found in the PDF.`);
        row = { questions: withoutFinance(all), summary: summariseForm(all), documents: listDocuments(fdir, root), status: 'ok', note: null, notes };
      }
      await pool.query(
        `INSERT INTO finalist_forms (cohort, applicant_id, folder, pages, questions, summary, documents, status, kind, note, notes, missing_files, imported_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, NOW())
         ON CONFLICT (cohort, applicant_id) DO UPDATE SET folder=$3, pages=$4, questions=$5, summary=$6, documents=$7, status=$8, kind=$9, note=$10, notes=$11, missing_files=$12, imported_at=NOW()`,
        [...base, JSON.stringify(row.questions), JSON.stringify(row.summary), JSON.stringify(row.documents), row.status, form.kind, row.note, JSON.stringify(row.notes), row.status === 'ok' ? JSON.stringify(missingFiles) : null],
      );
      done++;
      log(`${county}/${folder}`);
    } catch (err) { problems.push(`${county}/${folder}: ${err.message}`); }
  }
  await Promise.allSettled([cacheInvalidate(`finalists:${cohort}:*`)]);
  return { read: done, problems, wrongApplication, root };
}

// ── what the dashboard shows ──
const typeCounts = (docs) => {
  const out = {};
  for (const d of docs ?? []) if (d.type !== 'Application form') out[d.type] = (out[d.type] ?? 0) + 1;
  return out;
};

const FIN_DOCS = ['Bank statements', 'M-Pesa statements', 'Income statements', 'Balance sheets', 'Cash-flow statements', 'Financial statements', 'Books and receipts'];

export async function getFinalistList(cohort) {
  const cfg = COHORTS[cohort];
  const { rows } = await pool.query(
    `SELECT f.*, ff.summary, ff.documents, ff.pages, ff.status AS form_status, ff.note AS form_note, ff.notes AS form_notes, ff.missing_files, ff.kind AS form_kind
       FROM finalists f
       LEFT JOIN finalist_forms ff ON ff.cohort = f.cohort AND ff.applicant_id = f.applicant_id
      WHERE f.cohort = $1
      ORDER BY f.county, f.composite DESC NULLS LAST, f.cluster_name`, [cohort]);
  const meta = (await pool.query('SELECT rules FROM finalist_meta WHERE cohort = $1', [cohort])).rows[0];
  const data = rows.map((r) => {
    const counts = typeCounts(r.documents);
    // no folder was read for this finalist: 'missing'. Rows written before the status existed (only ever folders that were accepted) count as accepted.
    const formStatus = r.form_status ?? (r.summary || r.documents ? 'ok' : 'missing');
    return {
      cohort, applicant_id: r.applicant_id, application_id: r.application_id, cluster_name: r.cluster_name, application_number: r.application_number,
      registration_number: r.registration_number, registration_status: r.registration_status ?? r.summary?.registration_status ?? null,
      county: r.county, constituency: r.constituency, ward: r.ward, value_chain: r.value_chain, other_value_chain: r.other_value_chain ?? null,
      checks: r.checks, result: r.result, reason: r.reason, criteria: r.criteria, disqualifier: r.disqualifier, tier: r.tier,
      normalized: r.normalized, weighted: r.weighted,
      total: r.total == null ? null : Number(r.total), penalty: r.penalty == null ? null : Number(r.penalty), equity_points: r.equity_points == null ? null : Number(r.equity_points),
      composite: r.composite == null ? null : Number(r.composite), rank: r.rank, evaluator: r.evaluator,
      track_years: r.track_years == null ? null : Number(r.track_years), rank_in_county: r.rank_in_county,
      sheet_link: sheetRowLink(cfg, r.sheet_row),
      drive_link: r.drive_link ?? null,
      drive_file: r.drive_file ?? null,
      contact: r.contact ?? null,
      flags: r.flags ?? [],
      form: formStatus === 'ok' ? (r.summary ?? null) : null,
      form_status: formStatus,
      form_note: r.form_note ?? null,
      form_notes: r.form_notes ?? [],
      missing_files: r.missing_files ?? null,
      documents: { total: (r.documents ?? []).filter((d) => d.type !== 'Application form').length, by_type: counts, financial_types: FIN_DOCS.filter((t) => counts[t]) },
    };
  });
  return {
    data,
    meta: {
      rules: meta?.rules ?? { eligibility: [], disqualifiers: [], tiers: [], financial_evidence: [] },
      sheet: getFinalistSheetStatus(cohort),
      sheet_link: `https://docs.google.com/spreadsheets/d/${cfg.sheetId}/edit#gid=${cfg.gid}`,
      forms_read: data.filter((d) => d.form_status === 'ok').length,
      forms_wrong: data.filter((d) => d.form_status === 'wrong_application').length,
    },
  };
}

export async function getFinalistDetail(cohort, applicantId) {
  const { data } = await getFinalistList(cohort);
  const f = data.find((d) => d.applicant_id === applicantId);
  if (!f) return null;
  const { rows } = await pool.query('SELECT folder, pages, questions, documents FROM finalist_forms WHERE cohort = $1 AND applicant_id = $2', [cohort, applicantId]);
  const ff = rows[0];
  return {
    ...f,
    folder: ff?.folder ?? null,
    questions: ff?.questions ?? [],
    documents_list: (ff?.documents ?? []).map((d, index) => ({ index, name: d.name, type: d.type, size: d.size })),
  };
}

/** The absolute path of one document of a finalist, only ever from the list read from disk (never from the request). */
export async function getFinalistDocumentPath(cohort, applicantId, index) {
  const { rows } = await pool.query('SELECT documents FROM finalist_forms WHERE cohort = $1 AND applicant_id = $2', [cohort, applicantId]);
  const doc = rows[0]?.documents?.[index];
  if (!doc) return null;
  const root = resolve(COHORTS[cohort].bundlesDir);
  const full = resolve(root, doc.path);
  if (!full.startsWith(root + sep) || !existsSync(full)) return null;
  return { full, name: doc.name };
}
