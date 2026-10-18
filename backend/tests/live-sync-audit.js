/**
 * live-sync-audit.js: compares a RUNNING deployment (through its public API, signed in as the admin)
 * with what Google Drive holds right now. Read-only: it changes nothing anywhere.
 *
 *   node tests/live-sync-audit.js [https://kjet-dashboard.leadedgeconsults.com]
 *
 * Needs backend/.env (ADMIN_EMAIL, ADMIN_PASSWORD) and backend/service-account.json (Drive, read-only).
 * Uses about 90 API requests (the API allows 200 per 15 minutes per address).
 */
import 'dotenv/config';
import pool from '../src/db/pool.js';
import { initDriveClient, extractFolderId, listSubfolderContents, readApplicationCsvFromDrive } from '../src/services/driveService.js';
import { num, text } from '../src/services/applicationCsv.js';

const BASE = (process.argv[2] ?? 'https://kjet-dashboard.leadedgeconsults.com').replace(/\/$/, '');
const norm = (v) => (v == null ? '' : String(v).trim().replace(/\s+/g, ' ').toLowerCase());
const day = (v) => (v == null ? '' : String(v).slice(0, 10));   // "2013-08-19" or "2013-08-19T00:00:00.000Z"

const groups = new Map();      // group -> { checks, bad: [] }
function check(group, ok, detail) {
  const g = groups.get(group) ?? { checks: 0, bad: [] };
  g.checks++;
  if (!ok) g.bad.push(detail);
  groups.set(group, g);
}

async function api(path, cookie, init = {}) {
  const res = await fetch(BASE + path, { ...init, headers: { 'Content-Type': 'application/json', Origin: BASE, ...(cookie ? { Cookie: cookie } : {}), ...(init.headers ?? {}) } });
  return { status: res.status, headers: res.headers, json: await res.json().catch(() => null) };
}

// ── sign in to the live site ─────────────────────────────────
const login = await api('/api/auth/sign-in/email', null, {
  method: 'POST',
  body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }),
});
if (login.status !== 200) { console.error(`Sign-in to ${BASE} failed (HTTP ${login.status})`); process.exit(1); }
const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
console.log(`Signed in to ${BASE}\n`);

// ── read the live system ─────────────────────────────────────
const summary = (await api('/api/portfolio/summary', cookie)).json.data;
const list = (await api('/api/clusters?limit=100&sort=name', cookie)).json;
const live = new Map();
{
  const apps = list.data.map((c) => c.application_number);
  let i = 0;
  const work = async () => {
    while (i < apps.length) {
      const a = apps[i++];
      const r = await api(`/api/clusters/${a}`, cookie);
      if (r.status === 200) live.set(a, r.json.data); else check('live API returns every cluster', false, `${a}: HTTP ${r.status}`);
    }
  };
  await Promise.all([work(), work(), work(), work()]);
}
check('live API returns every cluster', list.total === 85 && live.size === 85, `total=${list.total}, detail pages=${live.size}`);

// ── read Drive ───────────────────────────────────────────────
await initDriveClient();
const { rows: dbClusters } = await pool.query('SELECT application_number a, google_drive_folder g FROM clusters ORDER BY 1');
const drive = new Map();
{
  let i = 0;
  const work = async () => {
    while (i < dbClusters.length) {
      const c = dbClusters[i++];
      const folder = extractFolderId(c.g);
      const [csv, sections] = await Promise.all([readApplicationCsvFromDrive(folder), listSubfolderContents(folder, true, c.a)]);
      drive.set(c.a, { csv: csv?.fields, files: sections.flatMap((s) => s.files.map((f) => ({ ...f, section: s.sectionName }))) });
    }
  };
  await Promise.all([work(), work(), work(), work()]);
}

// ── compare, cluster by cluster ──────────────────────────────
const sum = { cost: 0, grant: 0, contribution: 0, budget: 0, members: 0, women: 0, y3: 0 };
let driveFiles = 0;
for (const [a, d] of drive) {
  const c = live.get(a);
  if (!c || !d.csv) { check('cluster present in both', false, `${a}: live=${!!c} drive-csv=${!!d.csv}`); continue; }
  const f = d.csv;
  const T = (l) => text(f, l);
  const N = (l) => num(f, l);
  const contact = (type) => (c.contacts ?? []).find((x) => x.contact_type === type) ?? {};

  const str = (group, have, want) => check(group, norm(have) === norm(want), `${a}: live=${JSON.stringify(have)} drive=${JSON.stringify(want)}`);
  const numeric = (group, have, want, { nullStays = false, round = false } = {}) => {
    const h = have == null || have === '' ? null : Number(have);
    const w = want == null ? null : round ? Math.round(want) : want;
    const ok = nullStays ? (h === null && w === null) || (h !== null && w !== null && Math.abs(h - w) < 0.005) : (h ?? 0) === (w ?? 0) || Math.abs((h ?? 0) - (w ?? 0)) < 0.005;
    check(group, ok, `${a}: live=${h} drive=${w}`);
  };

  // identity
  str('identity: name', c.cluster_name, T('Cluster name'));
  str('identity: legal form', c.legal_form, T('Cluster legal form'));
  check('identity: registration date', day(c.registration_date) === day(T('Cluster registration date')), `${a}: live=${c.registration_date} drive=${T('Cluster registration date')}`);
  str('identity: county', c.county, T('Cluster county'));
  str('identity: constituency', c.constituency, T('Constituency'));
  str('identity: ward', c.ward, T('Ward'));
  str('identity: value chain', c.value_chain, T('Value Chain'));
  str('identity: status', c.status, T('Status'));
  str('identity: phone', c.phone, T('Cluster phone'));
  str('identity: email', c.email, T('Cluster email'));
  str('identity: address', c.physical_address, T('Cluster physical address'));
  // membership
  numeric('membership: men', c.men, N('Total members men'));
  numeric('membership: women', c.women, N('Total members women'));
  numeric('membership: youth', c.youth, N('Total members youth'));
  numeric('membership: pwd', c.pwd, N('Total members pwd'));
  // money
  numeric('money: total project cost', c.total_project_cost, N('Total project cost'), { nullStays: true });
  numeric('money: grant requested', c.grant_requested, N('Grant requested'), { nullStays: true });
  numeric('money: cluster contribution', c.cluster_contribution, N('Cluster contribution'), { nullStays: true });
  numeric('money: section 5 budget', c.section5_budget_total, N('Budget total'), { nullStays: true });
  numeric('money: machinery subtotal', c.machinery_subtotal, N('Machinery subtotal'), { nullStays: true });
  numeric('money: services subtotal', c.services_subtotal, N('Services subtotal'), { nullStays: true });
  // jobs
  numeric('jobs: today', c.jobs_today, N('Jobs today'), { nullStays: true, round: true });
  numeric('jobs: year 1', c.jobs_year1, N('Jobs year1'), { nullStays: true, round: true });
  numeric('jobs: year 3', c.jobs_year3, N('Jobs year3'), { nullStays: true, round: true });
  // contacts + bank
  str('contacts: authorized name', contact('authorized').full_name, T('Authorized name'));
  str('contacts: authorized phone', contact('authorized').phone, T('Authorized phone'));
  str('contacts: authorized email', contact('authorized').email, T('Authorized email'));
  str('contacts: manager name', contact('manager').full_name, T('Project manager name'));
  str('bank: name', c.banking?.bank_name, T('Cluster bank name'));
  str('bank: account (leading zeros kept)', c.banking?.bank_account, T('Cluster bank account'));
  // row counts
  const items = (label, keys) => { let n = 0; for (let i = 1; i <= 40; i++) if (keys.some((k) => { const v = f.get(`${label} ${i} ${k}`); return v !== undefined && v !== '' && !(k === 'total cost' && Number(v) === 0); })) n++; return n; };
  check('rows: machinery', (c.machinery ?? []).length === items('Machinery', ['desc', 'total cost']), `${a}: live=${(c.machinery ?? []).length} drive=${items('Machinery', ['desc', 'total cost'])}`);
  check('rows: services', (c.services ?? []).length === items('Service', ['desc', 'total cost']), `${a}: live=${(c.services ?? []).length} drive=${items('Service', ['desc', 'total cost'])}`);
  check('rows: products', (c.products ?? []).length === [1, 2, 3, 4, 5, 6, 7, 8].filter((i) => f.get(`Product ${i} name`)).length, `${a}: products`);
  check('rows: buyers', (c.buyers ?? []).length === [1, 2, 3, 4, 5, 6, 7, 8].filter((i) => f.get(`Buyer ${i} name`)).length, `${a}: buyers`);
  // a P&L row exists for every year in which Drive has ANY P&L value (not only years with revenue)
  const plYears = [1, 2, 3].filter((y) => [...f.keys()].some((k) => new RegExp('^Pl .* y' + y + ' (with|without)$').test(k) && f.get(k) !== '')).length;
  check('rows: profit and loss years', (c.pl ?? []).length === plYears, `${a}: live=${(c.pl ?? []).length} drive=${plYears}`);

  // files: every Drive file, with its checksum
  const dbDocs = new Map((c.documents ?? []).map((x) => [x.file_id, x]));
  check('files: same number as Drive', dbDocs.size === d.files.length, `${a}: live=${dbDocs.size} drive=${d.files.length}`);
  for (const file of d.files) {
    driveFiles++;
    const x = dbDocs.get(file.id);
    check('files: present in live database', !!x, `${a}: ${file.name}`);
    if (!x) continue;
    check('files: checksum equals Drive', (x.md5 ?? null) === (file.md5 ?? null), `${a}: ${file.name} live=${x.md5} drive=${file.md5}`);
    check('files: name and section equal Drive', x.original_filename === file.name && x.section === file.section, `${a}: ${file.name}`);
    check('files: contents processed (no error)', x.content_status != null && x.content_status !== 'error', `${a}: ${file.name} status=${x.content_status} ${x.content_error ?? ''}`);
  }
  for (const id of dbDocs.keys()) check('files: nothing extra that Drive no longer has', d.files.some((f) => f.id === id), `${a}: ${dbDocs.get(id).original_filename}`);

  sum.cost += N('Total project cost') ?? 0; sum.grant += N('Grant requested') ?? 0; sum.contribution += N('Cluster contribution') ?? 0;
  sum.budget += N('Budget total') ?? 0; sum.members += (N('Total members men') ?? 0) + (N('Total members women') ?? 0);
  sum.women += N('Total members women') ?? 0; sum.y3 += Math.round(N('Jobs year3') ?? 0);
}

// ── portfolio totals shown on the dashboard vs totals computed from Drive ──
const near = (a, b) => Math.abs(Number(a) - b) < 1;
check('dashboard totals: clusters', Number(summary.count) === drive.size, `live=${summary.count} drive=${drive.size}`);
check('dashboard totals: eligible cost', near(summary.cost, sum.cost), `live=${summary.cost} drive=${sum.cost}`);
check('dashboard totals: grant requested', near(summary.grant, sum.grant), `live=${summary.grant} drive=${sum.grant}`);
check('dashboard totals: cluster contribution', near(summary.contribution, sum.contribution), `live=${summary.contribution} drive=${sum.contribution}`);
check('dashboard totals: section 5 budget', near(summary.budget, sum.budget), `live=${summary.budget} drive=${sum.budget}`);
check('dashboard totals: members', Number(summary.members) === sum.members, `live=${summary.members} drive=${sum.members}`);
check('dashboard totals: women', Number(summary.women) === sum.women, `live=${summary.women} drive=${sum.women}`);
check('dashboard totals: jobs year 3', Number(summary.jobs_year3) === sum.y3, `live=${summary.jobs_year3} drive=${sum.y3}`);

// ── is the live poller running? ──
const st = (await api('/api/drive/status', cookie)).json;
const ageSec = st?.lastSync ? Math.round((Date.now() - new Date(st.lastSync).getTime()) / 1000) : null;
check('live poller: Drive integration enabled', st?.enabled === true, JSON.stringify(st));
check('live poller: checked Drive within the last 60 seconds', ageSec !== null && ageSec < 60, `last check ${ageSec}s ago`);

// ── report ───────────────────────────────────────────────────
let total = 0, bad = 0;
const width = Math.max(...[...groups.keys()].map((k) => k.length));
for (const [name, g] of groups) {
  total += g.checks; bad += g.bad.length;
  console.log(`${g.bad.length === 0 ? 'OK  ' : 'FAIL'}  ${name.padEnd(width)}  ${String(g.checks).padStart(5)} checks${g.bad.length ? `, ${g.bad.length} differ` : ''}`);
}
console.log(`\n${drive.size} clusters and ${driveFiles} Drive files compared against ${BASE}`);
console.log(`RESULT: ${total - bad} of ${total} checks agree, ${bad} differ`);
if (bad) {
  console.log('\nExamples of differences:');
  for (const [name, g] of groups) g.bad.slice(0, 4).forEach((d) => console.log(`  [${name}] ${d}`));
}
await pool.end();
process.exit(bad ? 1 : 0);
