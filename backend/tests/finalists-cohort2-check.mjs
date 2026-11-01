/**
 * finalists-cohort2-check.mjs: checks the Cohort 2 finalists in the database against the live sheet (cell by cell), the sheet's
 * Final Contact Info tab (names, contacts), Google Drive (the links) and the bundle folders (identity, forms, documents).
 * Read-only apart from re-reading the sheet into the database.
 *
 *   node tests/finalists-cohort2-check.mjs
 */
import 'dotenv/config';
import { createRequire } from 'module';
import { createHash } from 'crypto';
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'fs';
import pool from '../src/db/pool.js';
import { initDriveClient, getDriveClient } from '../src/services/driveService.js';
import { COHORTS, COUNTIES, canonicalCounty, syncFinalistSheet, getFinalistList, getFinalistDetail } from '../src/services/finalists.js';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx'); const { PDFParse } = require('pdf-parse');
await initDriveClient();
await syncFinalistSheet(2, { force: true });
const cfg = COHORTS[2];
const drive = getDriveClient();
const res = await drive.files.export({ fileId: cfg.sheetId, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, { responseType: 'arraybuffer' });
const wb = XLSX.read(Buffer.from(res.data), { type: 'buffer', cellDates: false });
const grid = (n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '' });
const shown = new Map();   // sheet name -> rows as the sheet displays them
const cell = (sheet, a) => { const c = XLSX.utils.decode_cell(a); if (!shown.has(sheet)) shown.set(sheet, XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: '' })); return shown.get(sheet)[c.r]?.[c.c] ?? ''; };
const L = (i) => XLSX.utils.encode_col(i);
const s = (v) => String(v ?? '').replace(/\s+/g, ' ').trim() || null;
const nz = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));   // blank cells and error cells (#N/A) are no number
const nrm = (x) => String(x ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const sheetNotes = [];   // things that are wrong or odd in the spreadsheet itself
const groups = new Map();
const check = (g, ok, detail) => { const e = groups.get(g) ?? { n: 0, bad: [] }; e.n++; if (!ok) e.bad.push(detail); groups.set(g, e); };

const { data, meta } = await getFinalistList(2);
const sel = grid(cfg.tab); const head = sel[0].map((h) => String(h).replace(/\s+/g, ' ').trim());
const rows = sel.slice(1).map((r, i) => ({ r, row: i + 2 })).filter((x) => String(x.r[1]).trim());
const fci = new Map(grid(cfg.contactTab).slice(1).filter((x) => String(x[1]).trim()).map((x) => [String(x[1]).trim(), x]));
const by = new Map(data.map((d) => [d.application_id, d]));

check('count: 282 finalists, as many as the sheet', data.length === rows.length && data.length === 282, `${data.length} in the database, ${rows.length} in the sheet`);
check('keys are unique', new Set(data.map((d) => d.applicant_id)).size === data.length, 'duplicate keys');
const counties = new Map(); data.forEach((d) => counties.set(d.county, (counties.get(d.county) ?? 0) + 1));
check('47 counties, all official names', counties.size === 47 && [...counties.keys()].every((c) => COUNTIES.includes(c)), `${counties.size} counties; not official: ${[...counties.keys()].filter((c) => !COUNTIES.includes(c))}`);
check('six finalists in every county', [...counties.values()].every((n) => n === 6), JSON.stringify([...counties.entries()].filter(([, n]) => n !== 6)));

for (const { r, row } of rows) {
  const idCell = String(r[1]).trim(); const d = by.get(idCell); const tag = idCell;
  if (!d) { check('every sheet row is in the database', false, tag); continue; }
  const f = fci.get(idCell);
  const at = (c) => cell(cfg.tab, `${L(c)}${row}`);
  const col = (p) => head.findIndex((h) => h.startsWith(p));
  check('Application ID is the sheet\'s own text', d.application_id === s(at(1)), tag);
  check('link opens the finalist row of the sheet', d.sheet_link.endsWith(`gid=${cfg.gid}&range=A${row}`), tag);
  check('registration number (E1) as in the sheet', d.registration_number === s(at(2)) && d.checks.e1 === s(at(2)), `${tag}: ${d.registration_number} vs ${s(at(2))}`);
  check('county = the sheet\'s E2, in its official spelling', d.county === (canonicalCounty(at(3)) ?? s(at(3))), `${tag}: ${d.county} vs ${at(3)}`);
  check('value chain (E3) and "other" description as in the sheet', d.checks.e3 === s(at(4)) && d.other_value_chain === s(at(5)), tag);
  check('E4 and E5 notes are the evaluator\'s own words', d.checks.e4 === s(at(6)) && d.checks.e5 === s(at(7)), tag);
  check('evaluator\'s reason', d.reason === s(at(8)), tag);
  check('A3.1 to A3.6 ratings and logic', d.criteria.every((c, k) => c.rating === nz(at(9 + 2 * k)) && c.logic === s(at(10 + 2 * k))), tag);
  check('normalized scores', d.normalized.every((c, k) => c.value === nz(at(23 + k))), tag);
  check('weighted scores', d.weighted.every((c, k) => c.value === nz(at(29 + k))), tag);
  check('total, equity points, penalty, composite, rank', d.total === nz(at(col('TOTAL'))) && d.equity_points === nz(at(col('Equity Points'))) && d.penalty === nz(at(col('Penalty Points'))) && d.composite === nz(at(col('Sum of weighted'))) && d.rank === nz(at(col('Ranking'))), `${tag}: ${d.total}/${d.equity_points}/${d.composite}/${d.rank}`);
  const calc = d.weighted.reduce((a, c) => a + (c.value ?? 0), 0) + (d.equity_points ?? 0) - (d.penalty ?? 0);
  if (!(Math.abs(calc - (d.composite ?? NaN)) < 0.51)) sheetNotes.push(`${d.application_id} ${d.cluster_name}: weighted ${d.weighted.map((c) => c.value).join('+')} + equity ${d.equity_points ?? 0} - penalty ${d.penalty ?? 0} = ${calc}, but the sheet's composite is ${d.composite}`);
  const tier = s(at(22));
  check('tier: the Selected tab\'s, or the Final Contact Info tab\'s when blank (and flagged)', d.tier === (tier ?? s(f?.[11])) && (tier ? true : d.flags.some((x) => /tier is blank/.test(x))), `${tag}: ${d.tier} / ${tier}`);
  check('name, constituency and ward from Final Contact Info', !!f && d.cluster_name === s(f[2]) && d.constituency === s(f[4]) && d.ward === s(f[5]), tag);
  check('phone and e-mail from Final Contact Info', !!f && d.contact?.phone === s(f[8]) && d.contact?.alt_phone === s(f[9]) && d.contact?.email === s(f[10]), tag);
  check('every finalist has a name', !!d.cluster_name, tag);
}

// ── Drive links: every finalist has one, it is that cluster's own bundle, and it exists on Drive ──
const idFromUrl = (u) => (/\/(?:file\/d|drive\/folders)\/([^/?]+)/.exec(u ?? '') ?? [])[1];
const md5 = (path) => new Promise((rs, rj) => { const h = createHash('md5'); createReadStream(path).on('data', (c) => h.update(c)).on('end', () => rs(h.digest('hex'))).on('error', rj); });
const seenFiles = new Map(); const noLink = []; let zipsCompared = 0;
for (const d of data) {
  const tag = `${d.application_id} ${d.cluster_name}`;
  if (!d.drive_link) { check('a finalist without a Drive link is flagged', d.flags.some((x) => /not this finalist/.test(x)), `${tag}: ${JSON.stringify(d.flags)}`); noLink.push(d.applicant_id); continue; }
  check('the Drive link is a file or a folder on Drive', /^https:\/\/drive\.google\.com\/(file\/d|drive\/folders)\//.test(d.drive_link), tag);
  check('the file name in the link carries the finalist\'s own id', (d.drive_file ?? '').toUpperCase().includes(d.applicant_id.toUpperCase()), `${tag}: ${d.drive_file}`);
  const fid = idFromUrl(d.drive_link);
  check('no two finalists share a link', !seenFiles.has(fid), `${tag} shares a file with ${seenFiles.get(fid)}`);
  seenFiles.set(fid, tag);
  let m = null;
  try { m = (await drive.files.get({ fileId: fid, fields: 'name,trashed,md5Checksum,mimeType', supportsAllDrives: true })).data; } catch (e) { check('the Drive file can be read', false, `${tag}: ${e.message.slice(0, 80)}`); continue; }
  check('the Drive file is not in the bin', !m.trashed, tag);
  check('what Drive itself calls the item carries the finalist\'s own id (so the link is this cluster\'s)', /^\d+$/.test(d.applicant_id) ? new RegExp(`^application[ _]*${d.applicant_id}_bundle`, 'i').test(m.name) : m.name.toUpperCase().includes(d.applicant_id.toUpperCase()), `${tag}: Drive says ${m.name}`);
  check('the Drive item is named as the link text in the sheet says (the sheet sometimes shortens it)', m.name.startsWith(d.drive_file ?? '#none#'), `${tag}: Drive ${m.name} vs sheet ${d.drive_file}`);
  const det = await getFinalistDetail(2, d.applicant_id);
  if (det.folder && existsSync(`${cfg.bundlesDir}/${det.folder}`)) {
    const zip = readdirSync(`${cfg.bundlesDir}/${det.folder}`).find((x) => /\.zip$/i.test(x));
    if (zip && d.form_status === 'ok' && m.md5Checksum) { zipsCompared++; check('a local zip, where there is one, is byte-for-byte the Drive file', (await md5(`${cfg.bundlesDir}/${det.folder}/${zip}`)) === m.md5Checksum, `${tag}: ${zip}`); }
  }
}

// ── the bundle folders: identity, forms, documents ──
const root = cfg.bundlesDir;
const folders = []; for (const c of readdirSync(root)) for (const f of readdirSync(`${root}/${c}`)) folders.push({ county: c, folder: f, dir: `${root}/${c}/${f}` });
check('one folder per finalist, none left over', folders.length === data.length && folders.every((f) => by.has(f.folder)), `${folders.length} folders`);
const detailOf = new Map();
let wrong = 0, okPlatform = 0, okNumbered = 0, docsListed = 0, docsOnDisk = 0;
const walkCount = (dir) => { let n = 0; for (const e of readdirSync(dir, { withFileTypes: true })) n += e.isDirectory() ? walkCount(`${dir}/${e.name}`) : (/\.zip$/i.test(e.name) ? 0 : 1); return n; };
for (const f of folders) {
  const d = by.get(f.folder); if (!d) continue;
  const det = await getFinalistDetail(2, d.applicant_id); detailOf.set(d.applicant_id, det);
  const tag = `${f.county}/${f.folder}`;
  // independent reading of the application form's identity, straight from the PDF text
  const pdf = readdirSync(f.dir).find((x) => /^application.*\.pdf$/i.test(x));
  const p = new PDFParse({ data: new Uint8Array(readFileSync(`${f.dir}/${pdf}`)) }); const text = (await p.getText()).text; await p.destroy();
  const platform = /KENYA JOBS AND ECONOMIC TRANSFORMATION/i.test(text.slice(0, 800));
  const key = d.applicant_id;
  const own = platform
    ? ((/Application No:\s*(KJET-[\w-]+)/.exec(text) ?? [])[1] ?? '').toUpperCase() === key.toUpperCase()
    : /^\d+$/.test(key) && ((/1\. Application ID\s*\n\s*(\S+)/.exec(text) ?? [])[1] ?? '') === key;
  check('a folder is shown exactly when its own form is the finalist\'s (independent reading of the PDF)', own === (d.form_status === 'ok'), `${tag}: own=${own} status=${d.form_status}`);
  if (d.form_status !== 'ok') {
    wrong++;
    check('a folder with another cluster\'s application shows no questions, no figures and no documents', det.questions.length === 0 && d.form === null && det.documents_list.length === 0 && d.documents.total === 0, tag);
    check('...and says why', d.form_status === 'wrong_application' && !!d.form_note, tag);
    continue;
  }
  platform ? okPlatform++ : okNumbered++;
  check('finance questions are not stored', !det.questions.some((q) => /^(Total (revenue|profits) in|\d{4} (Annual Turnover|Net \(After-Tax\) Profit)|Do you know your price-cost margins|Describe your price \/ cost margins)/i.test(q.question) || /^Financial information$/.test(q.section)), tag);
  check('no page markers or section headings left in answers', !det.questions.some((q) => /^-- \d+ of \d+ --$/m.test(q.answer) || /^\d+\. (ORGANISATION DETAILS|LOCATION INFORMATION|BUSINESS INFORMATION|CONTACT INFORMATION|LEADERSHIP & OWNERSHIP|WOMEN-OWNED ENTERPRISE|MEMBERSHIP & EMPLOYMENT BY YEAR|GENDER & AGE DEMOGRAPHICS|FINANCIAL INFORMATION|BUSINESS OPERATIONS & SYSTEMS|E-COMMERCE & MARKET INFORMATION|SUPPORTING DOCUMENTS|DECLARATIONS & TERMS|BUSINESS STRATEGY & CHALLENGES)/m.test(q.answer)), tag);
  check('no broken characters', !det.questions.some((q) => /�|â€|&#039;|&amp;/.test(q.answer + q.question)), tag);
  if (platform) {
    // membership and employment: the figures in the database are the PDF's own (independent regex on the PDF text)
    const pick = (re) => { const m = re.exec(text); return m ? Number(String(m[1]).replace(/,/g, '')) : null; };
    const wantM = [2022, 2023, 2024].map((y) => pick(new RegExp(`Total members in ${y}:\\s*\\n\\s*([\\d,]+)`)));
    const wantE = [2022, 2023, 2024].map((y) => pick(new RegExp(`Total employees in ${y}:\\s*\\n\\s*([\\d,]+)`)));
    check('members 2022 to 2024 = the PDF', [2022, 2023, 2024].every((y, i) => (d.form.members[y] ?? null) === wantM[i]), `${tag}: ${JSON.stringify(d.form.members)} vs ${wantM}`);
    check('employees 2022 to 2024 = the PDF', [2022, 2023, 2024].every((y, i) => (d.form.employees[y] ?? null) === wantE[i]), `${tag}: ${JSON.stringify(d.form.employees)} vs ${wantE}`);
    const wantName = (/What is the name of your cluster\?\s*\n(.+)/.exec(text) ?? [])[1]?.trim();
    check('cluster name on the form is stored as written', det.questions.find((q) => /name of your cluster/i.test(q.question))?.answer === wantName, `${tag}: ${wantName}`);
  } else {
    check('older form keeps its 56 non-finance questions', det.questions.length === 56, `${tag}: ${det.questions.length}`);
  }
  docsListed += det.documents_list.length; docsOnDisk += walkCount(f.dir);
}
check('every file (except .zip) of every accepted folder is listed', docsListed === docsOnDisk, `${docsListed} listed, ${docsOnDisk} on disk`);
check('every folder holds its own finalist application (the 17 wrong folders were replaced from Drive)', wrong === 0, `${wrong} folders rejected`);
const altNums = new Set(grid('C1 Alternates').flatMap((r) => r.map((c) => (/^applicant[\s_]*(\d+)$/i.exec(String(c).trim()) ?? [])[1]).filter(Boolean)));
for (const d of data.filter((x) => /^\d+$/.test(x.applicant_id))) check('a finalist whose Application ID is a Cohort 1 number is on the C1 Alternates tab of the sheet (a Cohort 1 alternate carried over)', altNums.has(d.applicant_id), `${d.application_id} ${d.cluster_name}`);
const wrongKeys = data.filter((x) => x.form_status === 'wrong_application').map((x) => x.applicant_id);
check('every finalist has a Drive link that really is its own bundle', noLink.length === 0, `finalists without a link: ${noLink}`);
const substituted = data.filter((x) => x.flags.some((f) => /is used instead/.test(f)));
check('the 16 finalists whose Selected-tab link opened another cluster use the right link from another tab, and are flagged', substituted.length === 16, `${substituted.length} flagged`);

console.log(`\nTHE SPREADSHEET ITSELF (not failures of ours): ${sheetNotes.length} row(s) whose composite is not their weighted scores plus equity points less penalty`); sheetNotes.forEach((n) => console.log('   ' + n));
console.log(`finalists shown without a Drive link: ${noLink.length}; links replaced by the right one from another tab: ${data.filter((x) => x.flags.some((f) => /is used instead/.test(f))).length}\n`);
let bad = 0;
for (const [g, e] of groups) { console.log(`${e.bad.length ? 'FAIL' : 'ok  '}  ${g.padEnd(98)} ${e.n - e.bad.length}/${e.n}`); bad += e.bad.length; e.bad.slice(0, 5).forEach((b) => console.log('        ' + b)); }
console.log(`\n${[...groups.values()].reduce((a, e) => a + e.n, 0)} checks, ${bad} failed | forms accepted: ${okPlatform} new-platform + ${okNumbered} older, rejected: ${wrong}, zips compared: ${zipsCompared}, forms_read ${meta.forms_read}, forms_wrong ${meta.forms_wrong}`);
await pool.end(); process.exit(bad ? 1 : 0);
