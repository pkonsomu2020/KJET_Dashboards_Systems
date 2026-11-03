/**
 * audit-finalists2.mjs: the Cohort 2 Finalists and Cohort 2 Overview data audit. Read-only.
 *
 *   node tests/audit/audit-finalists2.mjs [base url]
 *
 * The dashboard's finalists API is compared with the live Cohort 2 spreadsheet (tabs Selected and Final Contact Info, exported now and
 * read by a reader written for this audit) and with the finalist folders in COHORT_2_FINALISTS_BUNDLES. The Overview page draws its
 * numbers from the same rows, so they are recomputed here from the sheet with the same definitions.
 */
import 'dotenv/config';
import { createRequire } from 'module';
import { readdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { login, api, makeChecker, BASE } from './lib.mjs';
import { initDriveClient, getDriveClient } from '../../src/services/driveService.js';

const XLSX = createRequire(import.meta.url)('xlsx');
const SHEET = process.env.FINALISTS_C2_SHEET_ID || '1sIaLK5ro1jvcFUrBxx5zhrPSqkNtKIxJCdHmBOPG_pA';
const BUNDLES = resolve(process.env.FINALISTS_C2_BUNDLES_DIR ?? '../COHORT_2_FINALISTS_BUNDLES');
const { check, report } = makeChecker();
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const same = (a, b) => { const x = norm(a), y = norm(b); if (x === y) return true; if (x !== '' && y !== '' && !isNaN(Number(x)) && !isNaN(Number(y))) return Math.abs(Number(x) - Number(y)) < 0.005; return false; };
const fixText = (s) => String(s ?? '').replace(/â‰¥/g, '≥').replace(/â€”/g, '—').replace(/â€“/g, '–').replace(/â€™/g, '’').replace(/â€œ|â€\u009d|â€/g, '"');
const loose = (s) => norm(s).toLowerCase().replace(/[^a-z]/g, '').replace('elgeiyo', 'elgeyo');

await initDriveClient();
const drive = getDriveClient();
const { data: meta } = await drive.files.get({ fileId: SHEET, fields: 'name,modifiedTime', supportsAllDrives: true });
const wb = XLSX.read(Buffer.from((await drive.files.export({ fileId: SHEET, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, { responseType: 'arraybuffer' })).data), { type: 'buffer' });
const grid = (n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '' });
const sel = grid('Selected'), fc = grid('Final Contact Info');
console.log(`Cohort 2 sheet "${meta.name}", modified ${meta.modifiedTime}`);

const head = sel[0].map(norm);
const at = (name, from = 0) => { const i = head.findIndex((h, k) => k >= from && h.startsWith(name)); if (i < 0) throw new Error(`column ${name} not found`); return i; };
const idCol = at('Application ID');
const C = { id: idCol, e1: idCol + 1, e2: at('E2.'), e3: at('E3.'), other: at('IF OTHER PVC'), e4: at('E4.'), e5: at('E5.'), reason: at('REASON'), dq: at('DQ1'), tier: at('Tier 1'), total: at('TOTAL'), equity: at('Equity Points'), penalty: at('Penalty Points'), composite: at('Sum of weighted'), rank: at('Ranking from composite') };
const rateCols = [1, 2, 3, 4, 5, 6].map((n) => at(`A3.${n} `));                   // "A3.1 Name": the rating (its Logic follows)
const shortCols = head.map((h, i) => (/^A3\.\d$/.test(h) ? i : -1)).filter((i) => i >= 0);   // 6 normalised then 6 weighted
const keyOf = (cell) => norm(cell).replace(/^applicant[\s_]*/i, '');
const sheetRows = sel.slice(1).map((r, i) => ({ r, row: i + 2 })).filter(({ r }) => norm(r[C.id]) !== '' && keyOf(r[C.id]));
const sheet = new Map(sheetRows.map(({ r, row }) => [keyOf(r[C.id]), { r, row }]));
console.log(`Selected: ${sheetRows.length} finalists; Final Contact Info: ${fc.length - 1} rows`);

const fh = fc[0].map(norm); const F = (n) => fh.indexOf(n);
const contact = new Map(fc.slice(1).filter((r) => norm(r[F('Application ID')]) !== '').map((r) => [norm(r[F('Application ID')]), r]));

// ── the dashboard ──
const cookie = await login();
const list = await api('/api/finalists/2', cookie);
const rows = list.data;
const detail = new Map();
{ let i = 0; const work = async () => { while (i < rows.length) { const f = rows[i++]; detail.set(f.applicant_id, (await api(`/api/finalists/2/${encodeURIComponent(f.applicant_id)}`, cookie)).data); } }; await Promise.all([work(), work(), work()]); }
console.log(`Dashboard (${BASE}): ${rows.length} finalists, ${detail.size} profiles read\n`);

check('finalist count: dashboard = sheet', rows.length === sheet.size, `${rows.length} vs ${sheet.size}`);
check('same applicants in the dashboard and the sheet', [...sheet.keys()].sort().join() === rows.map((r) => r.applicant_id).sort().join(), `sheet-only ${[...sheet.keys()].filter((k) => !rows.some((r) => r.applicant_id === k))}; dashboard-only ${rows.filter((r) => !sheet.has(r.applicant_id)).map((r) => r.applicant_id)}`);
const perCounty = new Map(); for (const r of rows) perCounty.set(loose(r.county), (perCounty.get(loose(r.county)) ?? 0) + 1);
check('six finalists in every county', [...perCounty.values()].every((n) => n === 6), JSON.stringify([...perCounty].filter(([, n]) => n !== 6)));
check('47 counties', perCounty.size === 47, String(perCounty.size));

const flagsNote = [];
for (const f of rows) {
  const s = sheet.get(f.applicant_id); if (!s) continue;
  const { r, row } = s; const tag = `${f.applicant_id} ${f.cluster_name}`;
  const eq = (g, have, want) => check(`sheet: ${g}`, same(have, want), `${tag}: dashboard=${JSON.stringify(have)} sheet=${JSON.stringify(want)} (row ${row})`);
  eq('application id as written', f.application_id, r[C.id]);
  eq('registration number (E1)', f.checks.e1, r[C.e1]);
  check('sheet: county (E2)', loose(f.county) === loose(r[C.e2]), `${tag}: dashboard=${f.county} sheet=${r[C.e2]} (row ${row})`);
  check('sheet: value chain (E3)', loose(f.value_chain) === loose(r[C.e3]), `${tag}: dashboard=${f.value_chain} sheet=${r[C.e3]} (row ${row})`); eq('other value chain', f.other_value_chain ?? '', r[C.other]);
  eq('E4 note', fixText(f.checks.e4), fixText(r[C.e4])); eq('E5 note', fixText(f.checks.e5), fixText(r[C.e5]));
  eq('reason', fixText(f.reason), fixText(r[C.reason]));
  rateCols.forEach((c, i) => { const cr = f.criteria[i]; eq(`rating ${cr?.code}`, cr?.rating, r[c]); eq(`logic ${cr?.code}`, fixText(cr?.logic), fixText(r[c + 1])); });
  eq('disqualifier / penalty text', f.disqualifier ?? '', r[C.dq]);
  const cr = contact.get(norm(r[C.id]));
  const sheetTier = norm(r[C.tier]) || norm(cr?.[F('Tiers')]);
  eq('tier (blank in Selected falls back to Final Contact Info)', f.tier, sheetTier);
  shortCols.slice(0, 6).forEach((c, i) => eq(`normalised score ${i + 1}`, f.normalized[i]?.value, r[c]));
  shortCols.slice(6).forEach((c, i) => eq(`weighted score ${i + 1}`, f.weighted[i]?.value, r[c]));
  eq('total', f.total, r[C.total]); eq('equity points', f.equity_points ?? '', r[C.equity]); eq('penalty', f.penalty ?? '', r[C.penalty]);
  eq('composite score', f.composite, r[C.composite]); eq('rank (a #N/A in the sheet is blank)', f.rank ?? '', /^#/.test(r[C.rank]) ? '' : r[C.rank]);
  check('the sheet link opens this finalist\'s own row', String(f.sheet_link).includes(`range=A${row}`), `${tag}: ${f.sheet_link} (row ${row})`);

  // Final Contact Info
  check('contact info: the finalist has a row', !!cr, tag);
  if (cr) {
    const ec = (g, have, want) => check(`contact info: ${g}`, same(have, want), `${tag}: dashboard=${JSON.stringify(have)} sheet=${JSON.stringify(want)}`);
    ec('cluster name', f.cluster_name, cr[F('Cluster Name')]); ec('constituency', f.constituency, cr[F('Constituency')]); ec('ward', f.ward, cr[F('Ward')]);
    ec('phone', f.contact?.phone ?? '', cr[F('Contact')]); ec('alternate phone', f.contact?.alt_phone ?? '', cr[F('Alternate Contact')]); ec('email', f.contact?.email ?? '', cr[F('Email address')]);
    check('contact info: county = Selected county', loose(cr[F('County')]) === loose(r[C.e2]), `${tag}: contact=${cr[F('County')]} selected=${r[C.e2]}`);
    check('contact info: score = Selected composite', same(cr[F('Score')], r[C.composite]), `${tag}: contact=${cr[F('Score')]} selected=${r[C.composite]}`);
    check('contact info: value chain = Selected E3', loose(cr[F('Value Chain')]) === loose(r[C.e3]), `${tag}: contact=${cr[F('Value Chain')]} selected=${r[C.e3]}`);
  }
  // arithmetic the sheet should obey
  const wsum = shortCols.slice(6).reduce((t, c) => t + (Number(r[c]) || 0), 0);
  check('sheet arithmetic: weighted scores + equity points = TOTAL', Math.abs(wsum + (Number(r[C.equity]) || 0) - Number(r[C.total])) < 0.01, `${tag}: sum=${wsum} + equity ${r[C.equity] || 0} vs total=${r[C.total]} (row ${row})`);
  check('sheet arithmetic: composite = TOTAL - penalty', Math.abs(Number(r[C.total]) - (Number(r[C.penalty]) || 0) - Number(r[C.composite])) < 0.01, `${tag}: ${r[C.total]} - ${r[C.penalty] || 0} vs ${r[C.composite]} (row ${row})`);
}
// Selected rows that Final Contact Info does not cover, and the reverse
check('every Final Contact Info row is a finalist in Selected', [...contact.keys()].every((k) => sheet.has(keyOf(k))), `contact-only: ${[...contact.keys()].filter((k) => !sheet.has(keyOf(k)))}`);

// ── the page's Overview numbers, recomputed from the sheet with the same definitions ──
const view = (src) => {
  const comp = src.filter((x) => x.composite != null);
  const bins = [[30, 39], [40, 49], [50, 59], [60, 69], [70, 79], [80, 89], [90, 100]];
  const cnt = (k) => src.reduce((m, x) => m.set(k(x), (m.get(k(x)) ?? 0) + 1), new Map());
  const byCounty = new Map(); for (const x of comp) byCounty.set(loose(x.county), [...(byCounty.get(loose(x.county)) ?? []), x.composite]);
  return {
    finalists: src.length, average: comp.reduce((s, x) => s + x.composite, 0) / comp.length, high: Math.max(...comp.map((x) => x.composite)), low: Math.min(...comp.map((x) => x.composite)),
    tiers: JSON.stringify([...cnt((x) => x.tier || 'No tier')].sort()), chains: JSON.stringify([...cnt((x) => (x.chain || 'Not given').replace(/_/g, ' '))].sort()),
    spread: bins.map(([lo, hi]) => comp.filter((x) => x.composite >= lo && x.composite <= hi).length).join(),
    counties: JSON.stringify([...byCounty].map(([k, xs]) => [k, Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10]).sort()),
    e4yes: src.filter((x) => /^\s*yes\b/i.test(x.e4)).length, e4no: src.filter((x) => /^\s*no\b/i.test(x.e4)).length,
  };
};
const fromSheet = view(sheetRows.map(({ r }) => ({ composite: Number.isFinite(parseFloat(r[C.composite])) && r[C.composite] !== '' ? Number(r[C.composite]) : null, county: r[C.e2], tier: norm(r[C.tier]) || norm(contact.get(norm(r[C.id]))?.[F('Tiers')]), chain: norm(r[C.e3]).replace(/^other$/i, 'Other'), e4: norm(r[C.e4]) })));
const fromApi = view(rows.map((r) => ({ composite: r.composite, county: r.county, tier: r.tier, chain: r.value_chain, e4: r.checks.e4 ?? '' })));
for (const k of Object.keys(fromSheet)) check(`overview: ${k}`, JSON.stringify(fromSheet[k]) === JSON.stringify(fromApi[k]), `sheet=${String(fromSheet[k]).slice(0, 160)} dashboard=${String(fromApi[k]).slice(0, 160)}`);
// the Overview's other tiles
const fOf = (r) => detail.get(r.applicant_id)?.form ?? r.form;
const withForm = rows.filter((r) => r.form);
check('overview: forms read = finalists whose folder holds their own application', withForm.length === rows.filter((r) => r.form_status === 'ok').length, `${withForm.length} vs ${rows.filter((r) => r.form_status === 'ok').length}`);
check('overview: members stated per year add up from the forms', ['2022', '2023', '2024'].every((y) => withForm.reduce((s, r) => s + (r.form.members[y] ?? 0), 0) === withForm.reduce((s, r) => s + (fOf(r).members[y] ?? 0), 0)), '');

// ── the finalist folders ──
const folders = [];
for (const county of readdirSync(BUNDLES, { withFileTypes: true }).filter((e) => e.isDirectory())) {
  for (const f of readdirSync(join(BUNDLES, county.name), { withFileTypes: true }).filter((e) => e.isDirectory())) folders.push({ county: county.name, name: f.name, dir: join(BUNDLES, county.name, f.name) });
}
check('282 finalist folders on disk', folders.length === 282, String(folders.length));
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
let local = 0, listed = 0;
for (const fo of folders) {
  const k = keyOf(fo.name);
  const f = rows.find((r) => r.applicant_id === k);
  check('every folder belongs to a finalist', !!f, `${fo.county}/${fo.name}`);
  if (!f) continue;
  const files = walk(fo.dir).filter((p) => !/\.zip$/i.test(p) && !/MISSING_FILES_REPORT/i.test(p) && !/(^|[\\/])application_[^\\/]*\.pdf$/i.test(p));
  const d = detail.get(f.applicant_id);
  local += files.length; listed += d.documents?.total ?? 0;
  check('documents: the dashboard lists every file in the finalist folder', (d.documents?.total ?? 0) === files.length, `${f.applicant_id} ${f.cluster_name}: folder=${files.length} dashboard=${d.documents?.total}`);
  check('folder county = finalist county', loose(fo.county) === loose(f.county), `${f.applicant_id}: folder ${fo.county} vs ${f.county}`);
  const total = d.documents?.by_type ? Object.values(d.documents.by_type).reduce((t, n) => t + n, 0) : 0;
  check('documents: counts by type add up to the total', total === (d.documents?.total ?? 0), `${f.applicant_id}: ${total} vs ${d.documents?.total}`);
}
for (const f of rows) check('every finalist has a folder', folders.some((fo) => keyOf(fo.name) === f.applicant_id), `${f.applicant_id} ${f.cluster_name}`);
console.log(`Files: ${local} in the finalist folders (zip files, missing-file reports and the application PDF excluded), ${listed} listed by the dashboard`);
const byStatus = rows.reduce((m, r) => m.set(r.form_status, (m.get(r.form_status) ?? 0) + 1), new Map());
console.log(`Application forms by status: ${JSON.stringify([...byStatus])}; Drive links shown: ${rows.filter((r) => r.drive_link).length} of ${rows.length}; flags: ${rows.filter((r) => r.flags.length).length} rows\n`);

const bad = report('Cohort 2 Finalists and Overview');
writeFileSync(process.env.AUDIT_OUT ?? 'audit-finalists2-api.json', JSON.stringify({ rows, detail: Object.fromEntries(detail) }));
process.exit(bad ? 1 : 0);
