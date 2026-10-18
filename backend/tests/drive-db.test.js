/**
 * drive-db.test.js — Smoke tests for the Drive -> PostgreSQL pipeline.
 *
 * Needs: Postgres running, backend/.env, backend/service-account.json, Drive folders shared.
 * Run:   node tests/drive-db.test.js            (from backend/)
 *
 * It WRITES to the local database (corrupts a test cluster, then proves the sync repairs it),
 * so run it against your development database, not production.
 */
import 'dotenv/config';
import pool from '../src/db/pool.js';
import {
  initDriveClient, extractFolderId, readApplicationCsvFromDrive, downloadDriveFileBuffer,
  listFolderFiles, syncClusterFromDrive, syncAllClusters, __test,
} from '../src/services/driveService.js';
import { applyApplicationCsv } from '../src/services/applicationSync.js';
import { parseApplicationCsv, num, text } from '../src/services/applicationCsv.js';

let passed = 0;
let failed = 0;
const failures = [];
function check(label, ok, detail = '') {
  if (ok) { passed++; return; }
  failed++;
  failures.push(`${label}${detail ? ' | ' + detail : ''}`);
  console.error(`  FAIL  ${label}${detail ? ' | ' + detail : ''}`);
}
function section(name) { console.log(`\n${name}`); }
const q = async (sql, p = []) => (await pool.query(sql, p)).rows;
const norm = (v) => (v == null ? '' : String(v).trim().replace(/\s+/g, ' ').toLowerCase());

// ── 1. Drive access ──────────────────────────────────────────
section('1. Drive access');
check('Drive client initialises', await initDriveClient());
const clusters = await q('SELECT id, application_number a, google_drive_folder g FROM clusters ORDER BY application_number');
check('85 clusters in database', clusters.length === 85, String(clusters.length));

const csvByApp = new Map();   // application number -> { fields, raw }
for (const c of clusters) {
  const folderId = extractFolderId(c.g);
  check(`${c.a}: has a Drive folder link`, !!folderId);
  if (!folderId) continue;
  let res;
  try { res = await readApplicationCsvFromDrive(folderId); } catch (e) { check(`${c.a}: Drive folder readable`, false, e.message); continue; }
  check(`${c.a}: application_details.csv present`, !!res);
  if (!res) continue;
  const raw = (await downloadDriveFileBuffer(res.file.id, res.file.mimeType)).buffer.toString('utf8');
  csvByApp.set(c.a, { fields: res.fields, raw, file: res.file });
  check(`${c.a}: CSV Application No. matches`, res.fields.get('Application No.') === c.a, res.fields.get('Application No.'));
  const top = await listFolderFiles(folderId, true);
  check(`${c.a}: folder has Section_* subfolders`, top.files.some((f) => f.isFolder && /^Section_/i.test(f.name)));
}

// ── 2. Parser vs raw text (independent regex, not the parser) ─
section('2. Parser agrees with the raw file');
const rawNum = (raw, label) => {
  const m = raw.match(new RegExp('^' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ',([^\\r\\n]*)', 'm'));
  if (!m || m[1].trim() === '') return null;
  const n = Number(m[1].replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
};
for (const [a, { fields, raw }] of csvByApp) {
  for (const label of ['Total project cost', 'Grant requested', 'Cluster contribution', 'Jobs year3', 'Total members women', 'Total members men']) {
    check(`${a}: parser "${label}"`, num(fields, label) === rawNum(raw, label), `${num(fields, label)} vs ${rawNum(raw, label)}`);
  }
  // No numbered field (Service 6, Machinery 14, ...) may be swallowed into the previous value
  const numbered = /^([A-Z][A-Za-z]+(?: [A-Za-z]+)* \d+(?: [a-z0-9 ]+)?),/;
  const missing = [];
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(numbered);
    if (m && !fields.has(m[1])) missing.push(m[1]);
  }
  check(`${a}: every numbered label was parsed`, missing.length === 0, missing.slice(0, 5).join(', '));
}

// ── 3. Database equals Drive (scalar fields) ─────────────────
section('3. Database equals Drive, field by field');
const db = await q(`
  SELECT c.application_number a, c.cluster_name, c.legal_form, to_char(c.registration_date,'YYYY-MM-DD') reg, c.county, c.constituency, c.ward,
         c.value_chain, c.status, c.phone, c.email, c.physical_address,
         m.men, m.women, m.youth, m.pwd, m.total_members,
         f.total_project_cost, f.machinery_subtotal, f.services_subtotal, f.cluster_contribution, f.grant_requested, f.section5_budget_total,
         f.payback_period_years, f.irr_pct, f.npv_kes,
         e.jobs_today, e.jobs_year1, e.jobs_year3, e.jobs_women_year3, e.jobs_youth_year3, e.jobs_pwd_year3, e.income_today, e.income_year3,
         (SELECT full_name FROM cluster_contacts k WHERE k.cluster_id=c.id AND contact_type='authorized' LIMIT 1) auth_name,
         (SELECT phone FROM cluster_contacts k WHERE k.cluster_id=c.id AND contact_type='authorized' LIMIT 1) auth_phone,
         (SELECT email FROM cluster_contacts k WHERE k.cluster_id=c.id AND contact_type='authorized' LIMIT 1) auth_email,
         (SELECT full_name FROM cluster_contacts k WHERE k.cluster_id=c.id AND contact_type='manager' LIMIT 1) mgr_name,
         (SELECT bank_name FROM cluster_banking b WHERE b.cluster_id=c.id LIMIT 1) bank_name,
         (SELECT bank_account FROM cluster_banking b WHERE b.cluster_id=c.id LIMIT 1) bank_acct
  FROM clusters c
  LEFT JOIN cluster_membership m ON m.cluster_id=c.id LEFT JOIN cluster_financials f ON f.cluster_id=c.id LEFT JOIN cluster_employment e ON e.cluster_id=c.id`);
const T = (l) => (f) => text(f, l);
const N = (l) => (f) => num(f, l);
const specs = [
  ['cluster_name', T('Cluster name'), 's'], ['legal_form', T('Cluster legal form'), 's'], ['reg', T('Cluster registration date'), 's'],
  ['county', T('Cluster county'), 's'], ['constituency', T('Constituency'), 's'], ['ward', T('Ward'), 's'], ['value_chain', T('Value Chain'), 's'],
  ['status', T('Status'), 's'], ['phone', T('Cluster phone'), 's'], ['email', T('Cluster email'), 's'], ['physical_address', T('Cluster physical address'), 's'],
  ['men', N('Total members men'), 'n'], ['women', N('Total members women'), 'n'], ['youth', N('Total members youth'), 'n'], ['pwd', N('Total members pwd'), 'n'],
  ['total_members', (f) => (num(f, 'Total members men') ?? 0) + (num(f, 'Total members women') ?? 0), 'n'],
  ['total_project_cost', N('Total project cost'), 'z'], ['machinery_subtotal', N('Machinery subtotal'), 'z'], ['services_subtotal', N('Services subtotal'), 'z'],
  ['cluster_contribution', N('Cluster contribution'), 'z'], ['grant_requested', N('Grant requested'), 'z'], ['section5_budget_total', N('Budget total'), 'z'],
  ['payback_period_years', N('Machinery payback period'), 'z'], ['irr_pct', N('Machinery irr'), 'z'], ['npv_kes', N('Machinery npv'), 'z'],
  ['jobs_today', N('Jobs today'), 'r'], ['jobs_year1', N('Jobs year1'), 'r'], ['jobs_year3', N('Jobs year3'), 'r'],
  ['jobs_women_year3', N('Jobs women year3'), 'r'], ['jobs_youth_year3', N('Jobs youth year3'), 'r'], ['jobs_pwd_year3', N('Jobs pwd year3'), 'r'],
  ['income_today', N('Income today'), 'z'], ['income_year3', N('Income year3'), 'z'],
  ['auth_name', T('Authorized name'), 's'], ['auth_phone', T('Authorized phone'), 's'], ['auth_email', T('Authorized email'), 's'], ['mgr_name', T('Project manager name'), 's'],
  ['bank_name', T('Cluster bank name'), 's'], ['bank_acct', T('Cluster bank account'), 's'],
];
for (const row of db) {
  const csv = csvByApp.get(row.a);
  if (!csv) continue;
  for (const [col, get, kind] of specs) {
    const want = get(csv.fields);
    const have = row[col];
    let ok;
    if (kind === 's') ok = norm(have) === norm(want);
    else if (kind === 'n') ok = Number(have ?? 0) === Number(want ?? 0);
    else if (kind === 'r') ok = (have == null && want == null) || (have != null && want != null && Number(have) === Math.round(want));   // whole-number columns: Drive sometimes holds 14.98
    else ok = (have == null && want == null) || (have != null && want != null && Number(have) === Number(want));   // 'z': null stays null
    check(`${row.a}: ${col}`, ok, `db=${JSON.stringify(have)} drive=${JSON.stringify(want)}`);
  }
}

// ── 4. Child tables ──────────────────────────────────────────
section('4. Child tables match the file');
const count = async (t, id) => Number((await q(`SELECT COUNT(*)::int n FROM ${t} WHERE cluster_id=$1`, [id]))[0].n);
const indexedItems = (f, label, keyLabels) => {
  let n = 0;
  for (let i = 1; i <= 40; i++) if (keyLabels.some((k) => { const v = f.get(`${label} ${i} ${k}`); return v !== undefined && v !== '' && !(k === 'total cost' && Number(v) === 0); })) n++;
  return n;
};
for (const c of clusters) {
  const csv = csvByApp.get(c.a);
  if (!csv) continue;
  const f = csv.fields;
  const mach = indexedItems(f, 'Machinery', ['desc', 'total cost']);
  const serv = indexedItems(f, 'Service', ['desc', 'total cost']);
  const prods = [1, 2, 3, 4, 5, 6, 7, 8].filter((i) => f.get(`Product ${i} name`)).length;
  const buyers = [1, 2, 3, 4, 5, 6, 7, 8].filter((i) => f.get(`Buyer ${i} name`)).length;
  check(`${c.a}: machinery rows (${mach})`, (await count('cluster_machinery', c.id)) === mach);
  check(`${c.a}: service rows (${serv})`, (await count('cluster_services', c.id)) === serv);
  check(`${c.a}: product rows (${prods})`, (await count('cluster_products', c.id)) === prods);
  check(`${c.a}: buyer rows (${buyers})`, (await count('cluster_buyers', c.id)) === buyers);
  check(`${c.a}: 2 contact rows or fewer`, (await count('cluster_contacts', c.id)) <= 2);
  // machinery money adds up to what Drive says
  const sum = Number((await q('SELECT COALESCE(SUM(total_cost_kes),0) s FROM cluster_machinery WHERE cluster_id=$1', [c.id]))[0].s);
  const want = Array.from({ length: 40 }, (_, i) => num(f, `Machinery ${i + 1} total cost`) ?? 0).reduce((a, b) => a + b, 0);
  check(`${c.a}: machinery line totals`, Math.abs(sum - want) < 0.01, `${sum} vs ${want}`);
  const plYears = [1, 2, 3].filter((y) => f.get(`Pl revenue y${y} with`) || f.get(`Pl revenue y${y} without`)).length;
  const plDb = (await q('SELECT COUNT(*)::int n FROM cluster_pl WHERE cluster_id=$1 AND (revenue_with IS NOT NULL OR revenue_without IS NOT NULL)', [c.id]))[0].n;
  check(`${c.a}: P&L years with revenue`, plDb === plYears, `${plDb} vs ${plYears}`);
  const docs = await count('cluster_documents', c.id);
  check(`${c.a}: documents indexed from Drive (>0)`, docs > 0);
}

// ── 5. Business rules ────────────────────────────────────────
section('5. Compliance rule and ratios');
const fin = await q('SELECT cluster_id, total_project_cost t, grant_requested g, cluster_contribution c, grant_share_pct gs, cluster_share_pct cs, compliance_status s FROM cluster_financials');
for (const r of fin) {
  const t = r.t == null ? null : Number(r.t);
  const want = !t ? 'Missing financials'
    : Number(r.g) > 32000000 || Number(r.g) > t * 0.5 || Number(r.c) < t * 0.5 ? 'Review required' : 'Within limits';
  check(`cluster ${r.cluster_id}: compliance = ${want}`, r.s === want, r.s);
  if (t) {
    check(`cluster ${r.cluster_id}: grant share`, Math.abs(Number(r.gs) - (Number(r.g) / t) * 100) < 0.01, `${r.gs}`);
    check(`cluster ${r.cluster_id}: cash share`, Math.abs(Number(r.cs) - (Number(r.c) / t) * 100) < 0.01, `${r.cs}`);
  }
}

// ── 6. Idempotency ───────────────────────────────────────────
section('6. Re-syncing unchanged data changes nothing');
{
  const s = await syncAllClusters({ concurrency: 3 });
  check('full re-sync: 85/85 ok', s.synced === 85, s.failed.slice(0, 3).join('; '));
  check('full re-sync: 0 fields changed', s.changedFields === 0, String(s.changedFields));
}

// ── 7. Self-healing: corrupt the database, Drive wins ────────
section('7. A wrong value in the database is repaired from Drive');
{
  const app = clusters[10].a;
  const id = clusters[10].id;
  const good = (await q('SELECT total_project_cost, grant_requested FROM cluster_financials WHERE cluster_id=$1', [id]))[0];
  await pool.query('UPDATE cluster_financials SET total_project_cost = 1, grant_requested = 999 WHERE cluster_id=$1', [id]);
  await pool.query('UPDATE cluster_membership SET women = 99999 WHERE cluster_id=$1', [id]);
  await pool.query('DELETE FROM cluster_machinery WHERE cluster_id=$1', [id]);
  await pool.query("UPDATE cluster_banking SET bank_account = '1' WHERE cluster_id=$1", [id]);
  const t0 = Date.now();
  const r = await syncClusterFromDrive(app);
  const ms = Date.now() - t0;
  const after = (await q('SELECT total_project_cost, grant_requested FROM cluster_financials WHERE cluster_id=$1', [id]))[0];
  check('sync reports ok', r.ok === true, JSON.stringify(r));
  check('cost restored', Number(after.total_project_cost) === Number(good.total_project_cost));
  check('grant restored', Number(after.grant_requested) === Number(good.grant_requested));
  check('members restored', Number((await q('SELECT women FROM cluster_membership WHERE cluster_id=$1', [id]))[0].women) === num(csvByApp.get(app).fields, 'Total members women'));
  check('bank account restored', norm((await q('SELECT bank_account FROM cluster_banking WHERE cluster_id=$1', [id]))[0].bank_account) === norm(text(csvByApp.get(app).fields, 'Cluster bank account')));
  check('machinery rows restored', (await count('cluster_machinery', id)) === indexedItems(csvByApp.get(app).fields, 'Machinery', ['desc', 'total cost']));
  check('changes were logged', Number((await q("SELECT COUNT(*)::int n FROM drive_sync_log WHERE cluster_id=$1 AND synced_at > NOW() - INTERVAL '2 minutes'", [id]))[0].n) >= 4);
  check(`single-cluster sync fast (< 15s)`, ms < 15000, `${ms}ms`);
  console.log(`  single-cluster sync took ${ms} ms`);
}

// ── 8. Rollback safety ───────────────────────────────────────
section('8. A bad file never half-updates the database');
{
  const c = clusters[20];
  const before = JSON.stringify(await q('SELECT * FROM cluster_financials WHERE cluster_id=$1', [c.id]));
  const wrong = csvByApp.get(clusters[21].a).fields;           // another cluster's file
  const client = await pool.connect();
  let threw = false;
  try { await client.query('BEGIN'); await applyApplicationCsv(client, { id: c.id, application_number: c.a }, wrong); await client.query('COMMIT'); }
  catch { threw = true; await client.query('ROLLBACK'); } finally { client.release(); }
  check('wrong cluster file is rejected', threw);
  check('database unchanged after rejection', JSON.stringify(await q('SELECT * FROM cluster_financials WHERE cluster_id=$1', [c.id])) === before);
  const missing = await syncClusterFromDrive('KJET-0000-000000');
  check('unknown cluster handled', missing.ok === false);
}

// ── 9. Change detection plumbing ─────────────────────────────
section('9. Folder map and change attribution');
{
  await __test.buildFolderMap();
  check('folder map covers every cluster (>= 85 folders)', __test.folderMapSize() >= 85, String(__test.folderMapSize()));
  let deepOk = 0, deepTotal = 0;
  for (const c of clusters.slice(0, 25)) {
    const top = await listFolderFiles(extractFolderId(c.g), true);
    for (const sub of top.files.filter((f) => f.isFolder)) {
      deepTotal++;
      if ((await __test.resolveCluster(sub.id)) === c.a) deepOk++;
      const inner = await listFolderFiles(sub.id, true);
      for (const file of inner.files.slice(0, 1)) {
        deepTotal++;
        if ((await __test.resolveCluster(sub.id)) === c.a) deepOk++;
      }
    }
  }
  check(`section folders resolve to the right cluster (${deepOk}/${deepTotal})`, deepOk === deepTotal);
  check('unrelated folder id resolves to nothing', (await __test.resolveCluster('0000000000000000000')) === null);
}

// ── 10. Change feed replay (real Drive history through the real poller) ──
section('10. Poller handles real Drive change history');
{
  const drive = __test.getDriveClient();
  const { data } = await drive.changes.getStartPageToken();
  const now = Number(data.startPageToken);
  check('change feed token is numeric', Number.isFinite(now));
  __test.setChangesToken(String(Math.max(1, now - 300)));   // the last ~300 real changes
  const replayStart = new Date();
  const t0 = Date.now();
  await __test.pollChangesNow();
  console.log(`  replayed ~300 historical changes in ${Date.now() - t0} ms; token now ${__test.getChangesToken()}`);
  check('poller advanced its token', Number(__test.getChangesToken()) >= now - 5);
  // Re-syncing from Drive history must never change values that already equal Drive
  const changed = Number((await q("SELECT COUNT(*)::int n FROM drive_sync_log WHERE synced_at >= $1 AND field <> 'updated_at'", [replayStart]))[0].n);
  console.log(`  fields changed by the replay: ${changed}`);
  check('replay left the database equal to Drive', changed === 0, `${changed} changes`);
}

console.log(`\n${'─'.repeat(60)}\nResults: ${passed} passed, ${failed} failed`);
if (failed) { console.log('\nFirst failures:'); failures.slice(0, 25).forEach((f) => console.log('  -', f)); }
await pool.end();
process.exit(failed ? 1 : 0);
