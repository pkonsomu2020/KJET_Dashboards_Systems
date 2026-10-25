/**
 * evaluation-live-audit.js: checks the evaluation screens of a RUNNING dashboard (through its API,
 * signed in as the admin) against the two sources of truth, read fresh: the application files on Google
 * Drive (amounts, members, jobs) and the online evaluation sheet (scores, tests, findings).
 * Read-only: it changes nothing anywhere.
 *
 *   node tests/evaluation-live-audit.js [http://localhost:4455 | https://kjet-dashboard.leadedgeconsults.com]
 *
 * The screening is recomputed here straight from the sheet's own formulas, independently of the app.
 */
import 'dotenv/config';
import { createRequire } from 'module';
import pool from '../src/db/pool.js';
import { initDriveClient, getDriveClient, extractFolderId, readApplicationCsvFromDrive } from '../src/services/driveService.js';
import { num } from '../src/services/applicationCsv.js';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
const BASE = (process.argv[2] ?? 'http://localhost:4455').replace(/\/$/, '');

const groups = new Map();
const check = (group, ok, detail) => {
  const g = groups.get(group) ?? { checks: 0, bad: [] };
  g.checks++;
  if (!ok) g.bad.push(detail);
  groups.set(group, g);
};
const close = (a, b, tol = 0.01) => (a == null && b == null) || (a != null && b != null && Math.abs(Number(a) - Number(b)) <= tol);
const norm = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

async function api(path, cookie, init = {}) {
  const res = await fetch(BASE + path, { ...init, headers: { 'Content-Type': 'application/json', Origin: BASE, ...(cookie ? { Cookie: cookie } : {}) } });
  return { status: res.status, headers: res.headers, json: await res.json().catch(() => null), text: null };
}

// ── sign in ──
const login = await api('/api/auth/sign-in/email', null, { method: 'POST', body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }) });
if (login.status !== 200) { console.error(`Sign-in to ${BASE} failed (HTTP ${login.status})`); process.exit(1); }
const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');

// ── the dashboard ──
const list = (await api('/api/evaluation/clusters', cookie)).json;
const overview = (await api('/api/evaluation/overview', cookie)).json;
check('API returns 85 evaluated clusters', list?.data?.length === 85, `${list?.data?.length}`);
const live = new Map((list?.data ?? []).map((r) => [r.application_number, r]));

// ── Drive: the application CSV of every cluster ──
await initDriveClient();
const { rows: dbClusters } = await pool.query('SELECT application_number a, google_drive_folder g FROM clusters ORDER BY 1');
const csv = new Map();
{
  let i = 0;
  const work = async () => {
    while (i < dbClusters.length) {
      const c = dbClusters[i++];
      csv.set(c.a, (await readApplicationCsvFromDrive(extractFolderId(c.g)))?.fields);
    }
  };
  await Promise.all([work(), work(), work(), work()]);
}

// ── the online sheet ──
const res = await getDriveClient().files.export({ fileId: process.env.EVALUATION_SHEET_ID, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, { responseType: 'arraybuffer' });
const wb = XLSX.read(Buffer.from(res.data), { type: 'buffer', cellDates: false });
const cell = (sheet, ref) => wb.Sheets[sheet][ref]?.v ?? '';
const sheetRows = (name, col) => { const m = new Map(); for (let r = 6; r <= 120; r++) { const a = norm(cell(name, `${col}${r}`)); if (a.startsWith('KJET-')) m.set(a, r); } return m; };
const scRow = sheetRows('SCORECARD', 'C');
const elRow = sheetRows('Eligibility', 'B');
const fsRow = sheetRows('Financial_Screening', 'B');

// the sheet's rules (Parameters sheet)
const P = { cat1: Number(cell('Parameters', 'C5')), cat2: Number(cell('Parameters', 'C6')), share: Number(cell('Parameters', 'C7')), kjet: Number(cell('Parameters', 'C8')),
  tol: Number(cell('Parameters', 'C10')), minTotal: Number(cell('Parameters', 'C11')), minCash: Number(cell('Parameters', 'C12')) };
check('sheet rules read (5M, 32M, 50%)', P.cat1 === 5e6 && P.cat2 === 32e6 && P.share === 0.5 && P.kjet === 0.5, JSON.stringify(P));

function expectedResult(total, cash, grant, mach, serv, docCheck) {
  const cat = grant <= 0 ? 'Invalid grant' : grant <= P.cat1 ? 'Category 1' : grant <= P.cat2 ? 'Category 2' : 'cap';
  const arith = Math.abs(total - (cash + grant)) <= P.tol && (mach == null && serv == null || Math.abs(total - ((mach ?? 0) + (serv ?? 0))) <= P.tol);
  const implausible = total < P.minTotal || cash < P.minCash || grant < 0;
  const meets = total > 0 && cash / total >= P.share - 0.001;
  if (cat === 'Invalid grant' || implausible || !arith) return 'FOLLOW-UP: data error';
  if (cat === 'cap') return 'FOLLOW-UP: exceeds cap';
  if (!meets) return 'NON-COMPLIANT: <50% cash';
  if (String(docCheck ?? '').startsWith('Missing')) return 'FOLLOW-UP: documents';
  return 'PASS';
}

const WINDOW = { 'Category 1': 'Window 1 (Growth Window)', 'Category 2': 'Window 2 (Transformational Window)', 'Exceeds KES 32M cap': 'Above the Window 2 ceiling', 'Invalid grant (≤0)': 'Invalid grant (zero or less)', 'Incomplete data': 'Incomplete data' };
const decCols = ['I', 'K', 'M', 'O', 'Q', 'S', 'U', 'W', 'Y', 'AA'];
const critCols = { C1: 'P', C2: 'Y', C3: 'AE', C4: 'AJ', C5: 'AO', C6: 'AU' };
for (const [a, r] of live) {
  const f = csv.get(a);
  if (!f) { check('Drive CSV readable', false, a); continue; }
  // one set of amounts per cluster: the cluster's application_details.csv on Drive
  const fin = r.financial;
  const total = num(f, 'Total project cost'), cash = num(f, 'Cluster contribution'), grant = num(f, 'Grant requested');
  const mach = num(f, 'Machinery subtotal'), serv = num(f, 'Services subtotal');
  check('amounts: total project cost = application', close(fin.total, total), `${a}: ${fin.total} vs ${total}`);
  check('amounts: cluster cash contribution = application', close(fin.contribution, cash), `${a}: ${fin.contribution} vs ${cash}`);
  check('amounts: matching grant requested = application', close(fin.grant, grant), `${a}: ${fin.grant} vs ${grant}`);
  check('amounts: machinery subtotal = application', close(fin.machinery, mach), `${a}: ${fin.machinery} vs ${mach}`);
  check('amounts: services subtotal = application', close(fin.services, serv), `${a}: ${fin.services} vs ${serv}`);
  check('members: women = application (blank counts as 0)', close(r.women ?? 0, num(f, 'Total members women') ?? 0), `${a}: ${r.women} vs ${num(f, 'Total members women')}`);
  check('members: youth = application (blank counts as 0)', close(r.youth ?? 0, num(f, 'Total members youth') ?? 0), `${a}: ${r.youth} vs ${num(f, 'Total members youth')}`);
  check('jobs: year 3 = application', close(r.jobs_year3, num(f, 'Jobs year3')), `${a}: ${r.jobs_year3} vs ${num(f, 'Jobs year3')}`);

  // screening: the sheet's rules (Parameters sheet) applied to those amounts, worked out here independently
  if (total != null && cash != null && grant != null) {
    const exp = expectedResult(total, cash, grant, mach, serv, fin.document_check);
    check('screening result = the sheet rules on the application amounts', fin.result === exp, `${a}: ${fin.result} vs ${exp}`);
    const win = grant <= 0 ? 'Invalid grant (zero or less)' : grant <= P.cat1 ? 'Window 1 (Growth Window)' : grant <= P.cat2 ? 'Window 2 (Transformational Window)' : 'Above the Window 2 ceiling';
    check('screening window by matching grant requested', fin.category === win, `${a}: ${fin.category} vs ${win}`);
    check('screening: cluster cash share = cash / total', total > 0 ? close(fin.cluster_share, cash / total, 0.0001) : true, `${a}`);
    check('screening: maximum matching grant', total > 0 ? close(fin.max_eligible_grant, Math.min(total * P.kjet, P.cat2)) : true, `${a}: ${fin.max_eligible_grant}`);
    const shortfall = total > 0 ? Math.max(0, (total - Math.min(total * P.kjet, P.cat2)) - cash) : null;
    check('screening: cluster cash contribution shortfall', total > 0 ? close(fin.contribution_shortfall, shortfall) : true, `${a}: ${fin.contribution_shortfall} vs ${shortfall}`);
  }

  // scores and tests = the online sheet
  const sr = scRow.get(a), er = elRow.get(a);
  check('scorecard: row in the sheet', !!sr && !!er, a);
  if (!sr || !er) continue;
  check('scorecard: total score = sheet', close(r.score, cell('SCORECARD', `AY${sr}`)), `${a}: ${r.score} vs ${cell('SCORECARD', `AY${sr}`)}`);
  check('scorecard: band = sheet', norm(r.band) === norm(cell('SCORECARD', `AZ${sr}`)), `${a}`);
  check('eligibility: status = sheet', norm(r.eligibility) === norm(cell('Eligibility', `AC${er}`)), `${a}`);
  for (const k of r.criteria) check('scorecard: criterion points = sheet', close(k.score, cell('SCORECARD', `${critCols[k.code]}${sr}`)), `${a} ${k.code}`);
  decCols.forEach((col, i) => check('eligibility: E1-E10 decisions = sheet', norm(r.tests[`E${i + 1}`]) === norm(cell('Eligibility', `${col}${er}`)), `${a} E${i + 1}`));
}

// ── ranks: independent ordering of the eligible clusters ──
const eligible = [...live.values()].filter((r) => r.eligibility === 'PASS').sort((x, y) => (y.score - x.score) || (y.criteria[1].score - x.criteria[1].score) || (y.criteria[0].score - x.criteria[0].score) || (y.criteria[5].score - x.criteria[5].score));
eligible.forEach((r, i) => check('rank among eligible', r.rank === i + 1, `${r.application_number}: ${r.rank} vs ${i + 1}`));
check('not-eligible clusters are not ranked', [...live.values()].filter((r) => r.eligibility !== 'PASS').every((r) => r.rank == null), 'a non-eligible cluster has a rank');

// ── overview totals add up to the list ──
const all = [...live.values()];
const cnt = (fn) => all.filter(fn).length;
const f = Object.fromEntries(overview.funnel.map((x) => [x.stage, x.count]));
check('overview: evaluated', f['Evaluated'] === all.length, `${f['Evaluated']}`);
check('overview: screening pass', f['Financial screening: pass'] === cnt((r) => r.financial.result === 'PASS'), `${f['Financial screening: pass']}`);
check('overview: eligible', f['Eligibility: pass'] === cnt((r) => r.eligibility === 'PASS'), `${f['Eligibility: pass']}`);
check('overview: score 70 or more', f['Score 70 or more'] === cnt((r) => r.band === 'Recommended'), `${f['Score 70 or more']}`);
check('overview: bands add up', overview.bands.reduce((s, b) => s + b.count, 0) === all.length, 'bands');
check('overview: financial results add up', overview.financial_results.reduce((s, b) => s + b.count, 0) === all.length, 'results');
check('overview: counties add up', overview.counties.reduce((s, b) => s + b.count, 0) === all.length, 'counties');
check('overview: value chains add up', overview.value_chains.reduce((s, b) => s + b.count, 0) === all.length, 'chains');
check('overview: score buckets add up', overview.score_distribution.reduce((s, b) => s + b.count, 0) === all.filter((r) => r.score != null).length, 'buckets');
for (const t of overview.tests) {
  check('overview: test pass/hold/fail', t.pass === cnt((r) => r.tests[t.test] === 'Pass') && t.hold === cnt((r) => r.tests[t.test] === 'Hold') && t.fail === cnt((r) => r.tests[t.test] === 'Fail'), t.test);
}
const county = overview.counties[0]?.name;
const one = (await api(`/api/evaluation/overview?county=${encodeURIComponent(county)}`, cookie)).json;
check('overview: county filter counts that county', one?.meta?.evaluated === cnt((r) => r.county === county), `${county}: ${one?.meta?.evaluated}`);

// ── a detail page and its report, for every cluster ──
let pdfs = 0;
for (const a of live.keys()) {
  const d = (await api(`/api/evaluation/clusters/${a}`, cookie)).json?.data;
  const sr = scRow.get(a);
  check('detail: 22 sub-indicator ratings', d?.criteria?.reduce((s, c) => s + c.indicators.length, 0) === 22, a);
  check('detail: 10 eligibility tests', d?.eligibility_tests?.length === 10, a);
  if (d && sr) {
    const cols = { 'C1.1': 'I', 'C1.2': 'J', 'C1.3': 'K', 'C1.4': 'L', 'C1.5': 'M', 'C1.6': 'N', 'C2.1': 'R', 'C2.2': 'S', 'C2.3': 'T', 'C2.4': 'U', 'C2.5': 'V', 'C2.6': 'W',
      'C3.1': 'AA', 'C3.2': 'AB', 'C3.3': 'AC', 'C4.1': 'AG', 'C4.2': 'AH', 'C5.1': 'AL', 'C5.2': 'AM', 'C6.1': 'AQ', 'C6.2': 'AR', 'C6.3': 'AS' };
    for (const c of d.criteria) for (const i of c.indicators) check('detail: sub-indicator rating = sheet', close(i.rating, cell('SCORECARD', `${cols[i.code]}${sr}`)), `${a} ${i.code}`);
    check('detail: expert remarks = sheet column', norm(d.expert_remarks) === norm(cell('SCORECARD', `BE${sr}`)), a);
  }
  if (d && sr) {
    check('names: primary assessor = sheet', norm(d.assessment?.assessor) === norm(cell('SCORECARD', `BA${sr}`)), a);
    check('names: expert reviewer = sheet', norm(d.assessment?.reviewer) === norm(cell('SCORECARD', `BD${sr}`)), a);
  }
}
const pdf = await fetch(`${BASE}/api/evaluation/clusters/${[...live.keys()][0]}/report.pdf`, { headers: { Cookie: cookie, Origin: BASE } });
const buf = Buffer.from(await pdf.arrayBuffer());
check('report: a PDF is produced', pdf.status === 200 && buf.slice(0, 4).toString() === '%PDF', `HTTP ${pdf.status}`);

// ── result ──
let total = 0, bad = 0;
console.log(`Evaluation audit of ${BASE}: ${live.size} clusters, Drive CSVs and the online sheet read now\n`);
for (const [name, g] of groups) {
  total += g.checks; bad += g.bad.length;
  console.log(`${g.bad.length ? 'FAIL' : 'OK  '}  ${name.padEnd(58)} ${g.checks} checks${g.bad.length ? `, ${g.bad.length} differ` : ''}`);
}
console.log(`\nRESULT: ${total - bad} of ${total} checks agree, ${bad} differ`);
if (bad) { console.log('\nExamples of differences:'); for (const [name, g] of groups) g.bad.slice(0, 6).forEach((d) => console.log(`  [${name}] ${d}`)); }
await pool.end();
process.exit(bad ? 1 : 0);
