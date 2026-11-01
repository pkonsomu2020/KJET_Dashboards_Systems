/**
 * finalists-cohort1-check.mjs: checks the Cohort 1 finalists in the database against the live sheet (cell by cell),
 * the sheet's Master List (names, membership, employees) and the bundle folders (names, documents). Read-only.
 *
 *   node tests/finalists-cohort1-check.mjs
 */
import 'dotenv/config';
import { createRequire } from 'module';
import { readdirSync } from 'fs';
import { createHash } from 'crypto';
import { createReadStream, existsSync } from 'fs';
import pool from '../src/db/pool.js';
import { initDriveClient, getDriveClient } from '../src/services/driveService.js';
import { COHORTS, syncFinalistSheet, getFinalistList, getFinalistDetail } from '../src/services/finalists.js';

const XLSX = createRequire(import.meta.url)('xlsx');
await initDriveClient();
await syncFinalistSheet(1, { force: true });
const cfg = COHORTS[1];
const res = await getDriveClient().files.export({ fileId: cfg.sheetId, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, { responseType: 'arraybuffer' });
const wb = XLSX.read(Buffer.from(res.data), { type: 'buffer', cellDates: false });
const cell = (sheet, a) => { const c = wb.Sheets[sheet][a]; return c == null ? '' : c.v; };
const nz = (v) => (v === '' || v == null ? null : Number(v));
const s = (v) => String(v ?? '').replace(/\s+/g, ' ').trim() || null;
const grid = (n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '' });

const groups = new Map();
const check = (g, ok, detail) => { const e = groups.get(g) ?? { n: 0, bad: [] }; e.n++; if (!ok) e.bad.push(detail); groups.set(g, e); };

const { data } = await getFinalistList(1);
const top = grid(cfg.tab);
const topRows = top.slice(2).map((r, i) => ({ r, row: i + 3 })).filter((x) => String(x.r[1]).trim());
check('count: 90 finalists, as many as the sheet', data.length === topRows.length && data.length === 90, `${data.length} in the database, ${topRows.length} in the sheet`);
check('every finalist has its application form read', data.every((d) => d.form), `${data.filter((d) => !d.form).map((d) => d.applicant_id)} have no form`);

const L = (i) => XLSX.utils.encode_col(i);
const at = (c, row) => cell(cfg.tab, `${L(c)}${row}`);
const by = new Map(data.map((d) => [d.applicant_id, d]));
for (const { r, row } of topRows) {
  const id = String(/(\d+)/.exec(r[1])[1]); const d = by.get(id); const tag = `applicant ${id}`;
  if (!d) { check('every sheet row is in the database', false, tag); continue; }
  check('link opens the finalist row of the sheet', d.sheet_link.endsWith(`gid=${cfg.gid}&range=A${row}`), `${tag} row ${row}: ${d.sheet_link}`);
  check('Application ID is the sheet\'s own text', d.application_id === s(at(1, row)), `${tag}: ${d.application_id} vs ${s(at(1, row))}`);
  check('county', d.county === s(at(3, row)), tag);
  check('registration number', d.registration_number === s(at(2, row)), tag);
  check('value chain', d.value_chain === s(at(4, row)), tag);
  check('E1 to E5 as in the sheet', [2, 3, 4, 5, 6].every((c, k) => d.checks[`e${k + 1}`] === s(at(c, row))), tag);
  check('pass/fail and reason', d.result === s(at(7, row)) && d.reason === s(at(8, row)), tag);
  check('A3.1 to A3.6 ratings and logic', d.criteria.every((c, k) => c.rating === nz(at(9 + 2 * k, row)) && c.logic === s(at(10 + 2 * k, row))), tag);
  check('normalized scores', d.normalized.every((c, k) => c.value === nz(at(23 + k, row))), tag);
  check('weighted scores', d.weighted.every((c, k) => c.value === nz(at(29 + k, row))), tag);
  check('total, penalty, composite, rank', d.total === nz(at(35, row)) && d.penalty === nz(at(36, row)) && d.composite === nz(at(37, row)) && d.rank === nz(at(38, row)), `${tag}: ${d.total}/${d.composite}/${d.rank}`);
  check('evaluator, years, rank in county, tier', d.evaluator === s(at(39, row)) && d.track_years === nz(at(40, row)) && d.rank_in_county === nz(at(42, row)) && d.tier === s(at(22, row)), tag);
  check('weighted scores add up to the total', Math.abs(d.weighted.reduce((a, c) => a + (c.value ?? 0), 0) - (d.total ?? NaN)) < 0.01, `${tag}: ${d.weighted.map((c) => c.value)} vs ${d.total}`);
  check('two finalists in each county', data.filter((x) => x.county === d.county).length === 2, `${tag} ${d.county}`);
}

// the Master List: the name, and the membership and employees the form states
const master = grid(cfg.masterTab); const mh = master[0].map((h) => String(h).trim()); const mc = (n) => mh.indexOf(n);
const mById = new Map(master.slice(1).filter((r) => String(r[0]).trim()).map((r) => [Number((/(\d{4})$/.exec(String(r[mc('Application Number')]).trim()) ?? [])[1]), r]));
for (const d of data) {
  const m = mById.get(Number(d.applicant_id)); const tag = `applicant ${d.applicant_id} ${d.cluster_name}`;
  check('named from the Master List', !!m && d.cluster_name === s(m[mc('Cluster Name')]), tag);
  if (!m || !d.form) continue;
  check('form members 2022 to 2024 = Master List', [2022, 2023, 2024].every((y) => d.form.members[y] === nz(m[mc(`Cluster Membership ${y}`)])), `${tag}: ${JSON.stringify(d.form.members)} vs ${[2022, 2023, 2024].map((y) => m[mc(`Cluster Membership ${y}`)])}`);
  check('form employees 2022 to 2024 = Master List', [2022, 2023, 2024].every((y) => d.form.employees[y] === nz(m[mc(`Employees ${y}`)])), `${tag}: ${JSON.stringify(d.form.employees)} vs ${[2022, 2023, 2024].map((y) => m[mc(`Employees ${y}`)])}`);
}

// the folders: one per finalist, the folder name carries the cluster name, every file is listed
const root = cfg.bundlesDir; const norm = (x) => String(x).toUpperCase().replace(/[^A-Z0-9]/g, '');
let files = 0;
const seen = {};
for (const c of readdirSync(root)) for (const f of readdirSync(`${root}/${c}`)) {
  const id = String((/(\d+)/.exec(f) ?? [])[1]); const d = by.get(id); const tag = `${c}/${f}`;
  check('every folder belongs to a finalist', !!d, tag); if (!d) continue;
  const det = await getFinalistDetail(1, id);
  check('folder is in the finalist county', norm(c) === norm(d.county) || norm(c).startsWith(norm(d.county).slice(0, 5)), `${tag} vs ${d.county}`);
  check('folder name carries the cluster name or its registration number', norm(f).includes(norm(d.cluster_name).slice(0, 10)) || norm(f).includes(norm(d.registration_number ?? '')), `${tag} vs ${d.cluster_name}`);
  check('finance questions are not stored', !det.questions.some((q) => /^(\d{4} (annual turnover|net \(after-tax\) profit)|do you know your price-cost margins)/i.test(q.question)), tag);
  check('no page markers or repeated page headers left in the answers', !det.questions.some((q) => /^-- \d+ of \d+ --$/m.test(q.answer) || /^Application Details$/m.test(q.answer)), tag);
  check('no stray text read as encoded punctuation', !det.questions.some((q) => /â€|&#039;|&amp;/.test(q.answer + q.question)), tag);
  for (const q of det.questions) { const k = `Q${q.n}`; (seen[k] ??= new Set()).add(q.question); }
  check('form keeps its 56 non-finance questions', det.questions.length === 56, `${tag}: ${det.questions.length}`);
  files += det.documents_list.length;
}
for (const [k, v] of Object.entries(seen)) check('every question reads the same in all 90 forms', v.size === 1, `${k} has ${v.size} versions: ${[...v].map((x) => x.slice(0, 60)).join(' | ')}`);
const count = (dir) => { let n = 0; for (const e of readdirSync(dir, { withFileTypes: true })) n += e.isDirectory() ? count(`${dir}/${e.name}`) : (/\.zip$/i.test(e.name) ? 0 : 1); return n; };
check('every file (except the .zip) is listed', files === count(root), `${files} listed, ${count(root)} on disk`);

// ── Drive links: every finalist has one, it is that cluster's own bundle, and it is the very file in the local bundle folder ──
const drive = getDriveClient();
const md5 = (path) => new Promise((res, rej) => { const h = createHash('md5'); createReadStream(path).on('data', (c) => h.update(c)).on('end', () => res(h.digest('hex'))).on('error', rej); });
const idFromUrl = (u) => (/\/file\/d\/([^/]+)/.exec(u ?? '') ?? [])[1];
const seenFiles = new Map();
for (const d of data) {
  const tag = `applicant ${d.applicant_id} ${d.cluster_name}`;
  check('every finalist has a Drive link', !!d.drive_link && /^https:\/\/drive\.google\.com\/file\/d\//.test(d.drive_link), tag);
  if (!d.drive_link) continue;
  check('the file name in the link carries the finalist\'s own applicant number', new RegExp(`^application[ _]*${d.applicant_id}_bundle`, 'i').test(d.drive_file ?? ''), `${tag}: ${d.drive_file}`);
  const fid = idFromUrl(d.drive_link);
  check('no two finalists share a link', !seenFiles.has(fid), `${tag} shares a file with ${seenFiles.get(fid)}`);
  seenFiles.set(fid, tag);
  let meta = null;
  try { meta = (await drive.files.get({ fileId: fid, fields: 'name,trashed,md5Checksum,size', supportsAllDrives: true })).data; } catch (e) { check('the Drive file can be read', false, `${tag}: ${e.message.slice(0, 80)}`); continue; }
  check('the Drive file is not in the bin', !meta.trashed, tag);
  check('the Drive file is named as the sheet says', meta.name === d.drive_file, `${tag}: Drive says ${meta.name}, sheet says ${d.drive_file}`);
  const det = await getFinalistDetail(1, d.applicant_id);
  const local = det.folder ? `${cfg.bundlesDir}/${det.folder}` : null;
  const zip = local && existsSync(local) ? readdirSync(local).find((f) => /\.zip$/i.test(f)) : null;
  if (!zip) { check('a zip of the bundle is in the local folder to compare with', false, tag); continue; }
  check('the Drive file is byte-for-byte the zip in this finalist\'s local folder', (await md5(`${local}/${zip}`)) === meta.md5Checksum, `${tag}: local ${zip} differs from Drive ${meta.name}`);
}

// the same row of the ALL SCORED tab (where the link sits) has this finalist's registration number and county
const all = grid('ALL SCORED'); const ah = all.findIndex((r) => String(r[0]).startsWith('Link to application bundle'));
const allById = new Map(all.slice(ah + 1).filter((r) => String(r[1]).trim()).map((r) => [Number((/(\d+)/.exec(r[1]) ?? [])[1]), r]));
const nrm = (x) => String(x).toUpperCase().replace(/[^A-Z0-9]/g, '');
for (const d of data) {
  const r = allById.get(Number(d.applicant_id)); const tag = `applicant ${d.applicant_id} ${d.cluster_name}`;
  check('the link row (ALL SCORED) is the same cluster: registration number', !!r && nrm(r[2]) === nrm(d.registration_number), `${tag}: ${r?.[2]} vs ${d.registration_number}`);
  check('the link row (ALL SCORED) is the same cluster: county', !!r && nrm(r[3]) === nrm(d.county), `${tag}: ${r?.[3]} vs ${d.county}`);
}

let bad = 0;
for (const [g, e] of groups) { console.log(`${e.bad.length ? 'FAIL' : 'ok  '}  ${g.padEnd(66)} ${e.n - e.bad.length}/${e.n}`); bad += e.bad.length; e.bad.slice(0, 6).forEach((b) => console.log('        ' + b)); }
console.log(`\n${[...groups.values()].reduce((a, e) => a + e.n, 0)} checks, ${bad} failed`);
await pool.end(); process.exit(bad ? 1 : 0);
