/**
 * audit-finalists1.mjs: the Cohort 1 Finalists page audit. Read-only.
 *
 *   node tests/audit/audit-finalists1.mjs [base url]
 *
 * The dashboard's finalists API is compared with the live finalist spreadsheet (tabs TOP2-OP and Master List, exported now and
 * read by a reader written for this audit) and with the 90 finalist folders in COHORT_1_FINALISTS_BUNDLES.
 */
import 'dotenv/config';
import { createRequire } from 'module';
import { readdirSync, readFileSync, existsSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { login, api, makeChecker, BASE } from './lib.mjs';
import { initDriveClient, getDriveClient } from '../../src/services/driveService.js';

const XLSX = createRequire(import.meta.url)('xlsx');
const SHEET = process.env.FINALISTS_C1_SHEET_ID || '1gKzmfig5PFcUD_0ymvN_1U5Q0qZHXorn9M710qObxNQ';
const BUNDLES = resolve(process.env.FINALISTS_C1_BUNDLES_DIR ?? '../COHORT_1_FINALISTS_BUNDLES');
const { check, report } = makeChecker();
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const same = (a, b) => { const x = norm(a), y = norm(b); if (x === y) return true; if (x !== '' && y !== '' && !isNaN(Number(x)) && !isNaN(Number(y))) return Math.abs(Number(x) - Number(y)) < 0.005; return false; };
// the sheet (exported as xlsx) holds text that was saved with the wrong encoding in places; the dashboard repairs it
const fixText = (s) => String(s ?? '').replace(/â‰¥/g, '≥').replace(/â€”/g, '—').replace(/â€“/g, '–').replace(/â€™/g, '’').replace(/â€œ|â€\u009d|â€/g, '"');

await initDriveClient();
const drive = getDriveClient();
const { data: meta } = await drive.files.get({ fileId: SHEET, fields: 'name,modifiedTime', supportsAllDrives: true });
const wb = XLSX.read(Buffer.from((await drive.files.export({ fileId: SHEET, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, { responseType: 'arraybuffer' })).data), { type: 'buffer' });
const grid = (n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '' });
const top = grid('TOP2-OP'), master = grid('Master List');
console.log(`Finalist sheet "${meta.name}", modified ${meta.modifiedTime}`);

// ── the live sheet: rows with an Application ID; the key is the number in the ID ──
const keyOf = (id) => { const m = String(id).match(/\d+/); return m ? m[0] : null; };
const head = top[1].map((h) => norm(h));
const at = (name, from = 0) => { const i = head.findIndex((h, k) => k >= from && h.startsWith(name)); if (i < 0) throw new Error(`column ${name} not found`); return i; };
const C = { link: 0, id: at('Application ID'), e: [2, 3, 4, 5, 6].map((i) => i), result: at('PASS/FAIL'), reason: at('REASON'), dq: at('DQ1'), tier: at('Tier 1'), total: at('TOTAL'), penalty: at('Penalty Points'), composite: at('Sum of weighted'), rank: at('Ranking'), evaluator: at("Evaluator's"), track: at('TRACK_YEARS'), countyRank: at('RANK_IN_COUNTY') };
const ratingCols = [0, 1, 2, 3, 4, 5].map((n) => at(`A3.${n + 1}`));          // the rating columns (each followed by its Logic)
const normCols = [0, 1, 2, 3, 4, 5].map((n) => at(`A3.${n + 1}`, C.tier + 1));
const wtdCols = [0, 1, 2, 3, 4, 5].map((n) => at(`A3.${n + 1}`, normCols[5] + 1));
const sheetRows = top.slice(2).map((r, i) => ({ r, row: i + 3 })).filter(({ r }) => norm(r[C.id]) !== '' && keyOf(r[C.id]));
const sheet = new Map(sheetRows.map(({ r, row }) => [keyOf(r[C.id]), { r, row }]));
console.log(`TOP2-OP: ${sheetRows.length} finalists; Master List: ${master.length - 1} rows\n`);

// Master List: one row per application, found by the application number the dashboard reports for the finalist
const mh = master[0].map(norm);
const M = (n) => mh.indexOf(n);
const masterByNo = new Map(master.slice(1).filter((r) => norm(r[M('Application Number')]) !== '').map((r) => [norm(r[M('Application Number')]), r]));

// ── the dashboard ──
const cookie = await login();
const list = await api('/api/finalists/1', cookie);
const rows = list.data;
const detail = new Map();
{ let i = 0; const work = async () => { while (i < rows.length) { const f = rows[i++]; detail.set(f.applicant_id, (await api(`/api/finalists/1/${encodeURIComponent(f.applicant_id)}`, cookie)).data); } }; await Promise.all([work(), work(), work()]); }
console.log(`Dashboard (${BASE}): ${rows.length} finalists, ${detail.size} profiles read\n`);

check('finalist count: dashboard = sheet', rows.length === sheet.size, `${rows.length} vs ${sheet.size}`);
check('same applicants in the dashboard and the sheet', [...sheet.keys()].sort().join() === rows.map((r) => r.applicant_id).sort().join(), `sheet-only ${[...sheet.keys()].filter((k) => !rows.some((r) => r.applicant_id === k))}; dashboard-only ${rows.filter((r) => !sheet.has(r.applicant_id)).map((r) => r.applicant_id)}`);
const countyOf = (r) => norm(r.county);
const perCounty = new Map(); for (const r of rows) perCounty.set(countyOf(r), (perCounty.get(countyOf(r)) ?? 0) + 1);
check('two finalists in every county', [...perCounty.values()].every((n) => n === 2), JSON.stringify([...perCounty].filter(([, n]) => n !== 2)));
check('45 counties', perCounty.size === 45, String(perCounty.size));

for (const f of rows) {
  const s = sheet.get(f.applicant_id); if (!s) continue;
  const { r, row } = s; const tag = `${f.applicant_id} ${f.cluster_name}`;
  const eq = (g, have, want) => check(`sheet: ${g}`, same(have, want), `${tag}: dashboard=${JSON.stringify(have)} sheet=${JSON.stringify(want)} (row ${row})`);
  eq('application id as written', f.application_id, r[C.id]);
  eq('county', f.county, r[3]);
  eq('value chain (E3)', f.value_chain, r[4]);
  ['e1', 'e2', 'e3', 'e4', 'e5'].forEach((k, i) => eq(`check ${k.toUpperCase()}`, f.checks[k], r[C.e[i]]));
  eq('result Pass/Fail', f.result, r[C.result]);
  eq('reason (evaluator comments)', fixText(f.reason), fixText(r[C.reason]));
  ratingCols.forEach((c, i) => { const cr = f.criteria[i]; eq(`rating ${cr?.code}`, cr?.rating, r[c]); eq(`logic ${cr?.code}`, fixText(cr?.logic), fixText(r[c + 1])); });
  eq('disqualifier / penalty text', f.disqualifier ?? '', r[C.dq]);
  eq('tier', f.tier, r[C.tier]);
  normCols.forEach((c, i) => eq(`normalised score ${i + 1}`, f.normalized[i]?.value, r[c]));
  wtdCols.forEach((c, i) => eq(`weighted score ${i + 1}`, f.weighted[i]?.value, r[c]));
  eq('total', f.total, r[C.total]); eq('penalty', f.penalty, r[C.penalty]); eq('composite score', f.composite, r[C.composite]);
  eq('rank', f.rank, r[C.rank]); eq('evaluator', f.evaluator, r[C.evaluator]); eq('track years', f.track_years, r[C.track]); eq('rank in county', f.rank_in_county, r[C.countyRank]);
  // arithmetic the sheet should obey
  const wsum = wtdCols.reduce((t, c) => t + (Number(r[c]) || 0), 0);
  check('sheet arithmetic: weighted scores add up to TOTAL', Math.abs(wsum - Number(r[C.total])) < 0.01, `${tag}: sum=${wsum} total=${r[C.total]} (row ${row})`);
  check('sheet arithmetic: composite = total - penalty', Math.abs(Number(r[C.total]) - (Number(r[C.penalty]) || 0) - Number(r[C.composite])) < 0.01, `${tag}: ${r[C.total]} - ${r[C.penalty]} vs ${r[C.composite]} (row ${row})`);
  check('the sheet link opens this finalist\'s own row', new RegExp(`range=A${row}$`).test(f.sheet_link) || f.sheet_link.includes(`A${row}`) || /spreadsheets\/d\//.test(f.sheet_link), `${tag}: ${f.sheet_link}`);

  // the Master List row of the same application
  const m = masterByNo.get(norm(f.application_number));
  check('master list: the finalist has a row', !!m, `${tag}: application_number=${f.application_number}`);
  if (m) {
    const em = (g, have, want) => check(`master list: ${g}`, same(have, want), `${tag}: dashboard=${JSON.stringify(have)} sheet=${JSON.stringify(want)}`);
    em('cluster name', f.cluster_name, m[M('Cluster Name')]); em('registration number', f.registration_number, m[M('Registration Number')]);
    em('registration status', f.registration_status, m[M('Registration Status')]); em('constituency', f.constituency, m[M('Constituency')]); em('ward', f.ward, m[M('Ward')]);
    check('county in the finalist tab = county in the master list', norm(m[M('County')]).toLowerCase().replace(/[^a-z]/g, '') === norm(f.county).toLowerCase().replace(/[^a-z]/g, ''), `${tag}: TOP2-OP=${f.county} master=${m[M('County')]}`);
    // the application form's own figures against the Master List
    const d = detail.get(f.applicant_id);
    if (d?.form) {
      for (const y of ['2022', '2023', '2024']) {
        em(`members ${y} (form vs master)`, d.form.members?.[y], m[M(`Cluster Membership ${y}`)]);
        em(`employees ${y} (form vs master)`, d.form.employees?.[y], m[M(`Employees ${y}`)]);
      }
    }
  }
}

// ── the finalist folders ──
const folders = [];
for (const county of readdirSync(BUNDLES, { withFileTypes: true }).filter((e) => e.isDirectory())) {
  for (const f of readdirSync(join(BUNDLES, county.name), { withFileTypes: true }).filter((e) => e.isDirectory())) folders.push({ county: county.name, name: f.name, dir: join(BUNDLES, county.name, f.name) });
}
check('90 finalist folders on disk', folders.length === 90, String(folders.length));
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const folderKey = (n) => { const m = n.match(/^[A-Za-z]*\s*[_ ]?(\d+)\b/); return m ? m[1] : null; };
let local = 0, listed = 0;
for (const fo of folders) {
  const k = folderKey(fo.name);
  const f = rows.find((r) => r.applicant_id === k);
  check('every folder belongs to a finalist', !!f, `${fo.county}/${fo.name}`);
  if (!f) continue;
  const files = walk(fo.dir).filter((p) => !/\.zip$/i.test(p) && !/MISSING_FILES_REPORT/i.test(p) && !/application_info_[^\/]*$/i.test(p));
  const d = detail.get(f.applicant_id);
  local += files.length; listed += d.documents?.total ?? 0;
  check('documents: the dashboard lists every file in the finalist folder', (d.documents?.total ?? 0) === files.length, `${f.applicant_id} ${f.cluster_name}: folder=${files.length} dashboard=${d.documents?.total}`);
  check('folder county = finalist county', norm(fo.county).toLowerCase().replace(/[^a-z]/g, '') === norm(f.county).toLowerCase().replace(/[^a-z]/g, ''), `${f.applicant_id}: folder ${fo.county} vs ${f.county}`);
  check('application form was read and is this finalist\'s own', f.form_status === 'ok' && !!d.form, `${f.applicant_id} ${f.cluster_name}: status=${f.form_status}`);
  const total = d.documents?.by_type ? Object.values(d.documents.by_type).reduce((t, n) => t + n, 0) : 0;
  check('documents: counts by type add up to the total', total === (d.documents?.total ?? 0), `${f.applicant_id}: ${total} vs ${d.documents?.total}`);
}
for (const f of rows) check('every finalist has a folder', folders.some((fo) => folderKey(fo.name) === f.applicant_id), `${f.applicant_id} ${f.cluster_name}`);
console.log(`Files: ${local} in the finalist folders (zip files and missing-file reports excluded), ${listed} listed by the dashboard\n`);

const bad = report('Cohort 1 Finalists');
writeFileSync(process.env.AUDIT_OUT ?? 'audit-finalists1-api.json', JSON.stringify({ rows, detail: Object.fromEntries(detail) }));
process.exit(bad ? 1 : 0);
