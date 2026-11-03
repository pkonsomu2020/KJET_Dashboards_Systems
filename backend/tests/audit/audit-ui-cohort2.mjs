/**
 * audit-ui-cohort2.mjs: reads what the Cohort 2 pages SHOW in a real browser (headless Chrome) and compares it with the data.
 * Needs the app running (frontend, backend). Read-only.
 *
 *   UI_FRONT=http://localhost:5181 UI_API=http://localhost:4004 node tests/audit/audit-ui-cohort2.mjs <finalists json from audit-finalists2>
 *
 * Cohort 2 Overview (tiles and panels), Cohort 2 Finalists (a row for every finalist) and the profile of every finalist, tab by tab.
 */
import 'dotenv/config';
import { spawn } from 'child_process';
import { readFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { makeChecker } from './lib.mjs';

const { check, report } = makeChecker();
const fin = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FRONT = process.env.UI_FRONT ?? 'http://localhost:5173', API = process.env.UI_API ?? 'http://localhost:4000';
const login = await fetch(`${API}/api/auth/sign-in/email`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: FRONT }, body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }) });
if (!login.ok) throw new Error(`sign-in failed (HTTP ${login.status})`);
const cookies = login.headers.getSetCookie().map((c) => { const [nv] = c.split(';'); const i = nv.indexOf('='); return { name: nv.slice(0, i), value: nv.slice(i + 1) }; });
const CDP = 9400 + Math.floor(Math.random() * 500);
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'kjetaudit2-'))}`, '--window-size=1500,1000', 'about:blank'], { stdio: 'ignore' });
let tabs; for (let i = 0; i < 30; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); if (tabs.length) break; } catch { /* starting */ } await sleep(500); }
const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl); await new Promise((res) => { ws.onopen = res; });
let id = 0; const pend = new Map(); ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Page.enable'); await send('Network.enable');
for (const c of cookies) await send('Network.setCookie', { name: c.name, value: c.value, domain: 'localhost', path: '/' });
await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });
const go = async (path, ready) => { await send('Page.navigate', { url: FRONT + path }); for (let i = 0; i < 90; i++) { if (await ev(`!!document.querySelector(${JSON.stringify(ready)})`)) break; await sleep(1000); } await sleep(1200); };
const press = (sel, text) => ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.textContent.trim().startsWith(${JSON.stringify(text)})); if (!e) return false; for (const t of ['mousedown','mouseup','click']) e.dispatchEvent(new MouseEvent(t, { bubbles: true })); return true; })()`);
const flat = (s) => String(s ?? '').replace(/\s+/g, ' ');
const sq = (s) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/&amp;/g, '&').replace(/[^a-z0-9]/g, '');
const num = (v) => new Intl.NumberFormat('en-KE').format(v);
const rows = fin.rows, detail = fin.detail;

// ── 1. Cohort 2 Overview ──
await go('/cohort-2/overview', '.metrics-grid .metric');
let t = flat(await ev('document.body.innerText'));
const has = (g, text) => check(g, t.includes(text), `expected "${text}" on the page`);
const counties = new Set(rows.map((r) => r.county)).size;
const comp = rows.filter((r) => r.composite != null);
const tier = (n) => rows.filter((r) => r.tier === n).length;
const withForm = rows.filter((r) => r.form);
has('overview tile: finalists', `${rows.length}`); has('overview tile: counties', `${counties} counties`);
has('overview tile: average composite score', (comp.reduce((s, r) => s + r.composite, 0) / comp.length).toFixed(1));
has('overview tile: tier 1 and tier 2', `${tier('Tier 1')} / ${tier('Tier 2')}`);
has('overview tile: Cohort 1 alternates', `${rows.filter((r) => /^\d+$/.test(r.applicant_id)).length}`);
has('overview tile: forms read', `${withForm.length} of ${rows.length}`);
has('overview: highest and lowest score', `${Math.max(...comp.map((r) => r.composite))} and ${Math.min(...comp.map((r) => r.composite))}`);
const chains = new Map(); for (const r of rows) chains.set((r.value_chain ?? 'Not given').replace(/_/g, ' '), (chains.get((r.value_chain ?? 'Not given').replace(/_/g, ' ')) ?? 0) + 1);
has('overview: value chains represented', `Value chains represented ${chains.size}`);
for (const k of chains.keys()) has('overview: every value chain is named', k);
const yrs = ['2022', '2023', '2024'].map((y) => [y, withForm.reduce((s, r) => s + (r.form.members[y] ?? 0), 0), withForm.reduce((s, r) => s + (r.form.employees[y] ?? 0), 0)]);
has('overview: forms the totals are added over', `Added up over the ${withForm.length} application forms`);
const latest = withForm.map((r) => { const d = r.form.demographics; const y = d ? Object.keys(d).filter((k) => d[k] && (d[k].females != null || d[k].males != null)).sort().pop() : undefined; return y && d ? d[y] : r.form; });
const tot = (k) => latest.reduce((s, x) => s + (x[k] ?? 0), 0);
const label = (name, v) => has(`overview represent: ${name}`, `${name} ${num(v)}`);
label('Women', tot('females')); label('Men', tot('males')); label('Aged 18 to 35', tot('age_18_35')); label('Aged 36 to 50', tot('age_36_50')); label('Over 50', tot('age_over_50'));
const bands = [[30, 39], [40, 49], [50, 59], [60, 69], [70, 79], [80, 89], [90, 100]];
for (const [lo, hi] of bands) { const n = comp.filter((r) => r.composite >= lo && r.composite <= hi).length; if (n) check('overview: score band is drawn', t.includes(lo === 90 ? '90 to 100' : `${lo} to ${hi}`), `${lo}-${hi}`); }
void yrs;

// ── 2. Cohort 2 Finalists: the table ──
await go('/cohort-2/finalists', '.fn-table tbody tr');
const table = await ev(`[...document.querySelectorAll('.fn-table tbody tr')].map((tr) => ({ name: tr.querySelector('.cluster-name')?.childNodes[0]?.textContent.trim(), id: tr.querySelector('.cluster-id')?.textContent.trim(), county: tr.children[1].textContent.trim(), ratings: [...tr.querySelectorAll('.fn-rate strong')].map((s) => s.childNodes[0].textContent.trim()), comp: tr.children[8]?.querySelector('strong')?.textContent.trim(), sub: tr.children[8]?.querySelector('.gr-sub')?.textContent.trim() }))`);
check('finalists page: 282 rows', table.length === 282, String(table.length));
for (const f of rows) {
  const row = table.find((x) => x.id === (f.application_id ?? `Applicant ${f.applicant_id}`));
  check('finalists page: a row for every finalist', !!row, `${f.applicant_id} ${f.cluster_name}`);
  if (!row) continue;
  check('finalists page: county', row.county === f.county, `${f.applicant_id}: ${row.county} vs ${f.county}`);
  check('finalists page: six ratings', row.ratings.join() === f.criteria.map((c) => c.rating ?? '-').join(), `${f.applicant_id}: ${row.ratings} vs ${f.criteria.map((c) => c.rating)}`);
  check('finalists page: composite score', Number(row.comp) === Number(f.composite), `${f.applicant_id}: ${row.comp} vs ${f.composite}`);
  check('finalists page: tier and rank', (row.sub ?? '').startsWith(`${f.tier ?? 'No tier'} · rank ${f.rank ?? '-'}`), `${f.applicant_id}: ${row.sub} vs ${f.tier} rank ${f.rank}`);
  check('finalists page: name', sq(row.name).includes(sq(f.cluster_name).slice(0, 12)), `${f.applicant_id}: ${row.name} vs ${f.cluster_name}`);
}

// ── 3. Every finalist's profile, tab by tab ──
const TABS = ['Overview', 'Eligibility', 'Evaluation', 'Application', 'Membership', 'Documents'];
const dialogText = () => ev(`(document.querySelector('[role=dialog]')?.innerText ?? '')`);
let opened = 0; const notes = [];
const ONLY = process.env.ONLY_IDS ? new Set(JSON.parse(readFileSync(process.env.ONLY_IDS, 'utf8'))) : null;
for (const f of rows) {
  if (ONLY && !ONLY.has(f.applicant_id)) continue;
  const d = detail[f.applicant_id]; const tag = `${f.applicant_id} ${f.cluster_name}`;
  const clicked = await ev(`(() => { const b = [...document.querySelectorAll('.fn-table tbody tr')].find((tr) => tr.querySelector('.cluster-id')?.textContent.trim() === ${JSON.stringify(f.application_id ?? `Applicant ${f.applicant_id}`)})?.querySelector('.profile-link'); if (!b) return false; b.click(); return true; })()`);
  check('profile: the View profile button opens', clicked, tag);
  if (!clicked) continue;
  for (let i = 0; i < 30 && !(await ev("!!document.querySelector('[role=dialog] [role=tab]')")); i++) await sleep(300);
  await sleep(350); opened++;
  const seen = {}; let raw = '';
  for (const name of TABS) {
    await press('[role=dialog] [role=tab]', name); await sleep(Number(process.env.TAB_WAIT ?? 220));
    const rawText = await dialogText(); raw += ' ' + rawText; seen[name] = sq(rawText);
  }
  const all = Object.values(seen).join('');
  const inTab = (g, tab, expected) => { const e = sq(expected); if (e === '') return; check(`profile ${tab}: ${g}`, seen[tab].includes(e), `${tag}: "${String(expected).slice(0, 80)}"`); };
  inTab('cluster name', 'Overview', f.cluster_name); inTab('application id', 'Overview', f.application_id); inTab('county', 'Overview', f.county);
  inTab('composite score', 'Overview', `Composite score ${f.composite != null ? Number(f.composite).toLocaleString('en-KE', { maximumFractionDigits: 1 }) : ''}`);
  inTab('tier', 'Overview', f.tier ?? '');
  inTab('E4 note', 'Eligibility', f.checks.e4); inTab('E5 note', 'Eligibility', f.checks.e5); inTab('E3 value chain', 'Eligibility', f.checks.e3 ? f.checks.e3.replace(/_/g, ' ') : '');
  for (const c of f.criteria) inTab(`logic ${c.code}`, 'Evaluation', c.logic ?? '');
  if (sq(f.reason ?? '')) check('profile: the evaluator reason is shown (any tab)', all.includes(sq(f.reason)), `${tag}: "${String(f.reason).slice(0, 80)}"`);
  // answers the page takes from the spreadsheet instead of the form (the sheet's value is shown; a difference is noted separately)
  const SHEET_FIRST = [[/phone number\b/i, f.contact?.phone], [/alternate phone/i, f.contact?.alt_phone], [/email/i, f.contact?.email], [/registration number/i, f.registration_number],
    [/name of your cluster/i, f.cluster_name], [/constituency/i, f.constituency], [/\bward\b/i, f.ward], [/which county/i, f.county]];
  for (const q of d.questions ?? []) {
    const a = String(q.answer ?? '').trim(); if (!a) continue;
    if (/^(Application ID|Application Number|Submitted At)$/i.test(q.question.trim())) continue;       // the form's own header lines
    const plain = a.replace(/^\s*(?:[-–•*]|\d+[.)])\s*/gm, '');                                       // the page lays lists out without their markers
    const sheetVal = SHEET_FIRST.find(([re]) => re.test(q.question))?.[1];
    if (sheetVal != null && sq(sheetVal)) {
      check('profile: the sheet value of a contact/identity answer is shown', all.includes(sq(sheetVal)), `${tag}: ${sheetVal}`);
      if (!all.includes(sq(a)) && sq(a) !== sq(sheetVal)) notes.push(`${tag} Q${q.n} ${q.question.slice(0, 40)}: form="${a.slice(0, 40)}" sheet="${String(sheetVal).slice(0, 40)}"`);
      continue;
    }
    // exact (ignoring spacing and punctuation), else every word of the answer must be on the page (lists are re-laid out)
    const wordsOf = (t) => String(t).toLowerCase().normalize('NFKC').split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
    const shownWords = (d.__w ??= new Set(wordsOf(raw)));
    const missing = wordsOf(a).filter((w) => !shownWords.has(w));
    check(`profile answer shown: ${q.section} / ${String(q.question).slice(0, 55)}`, all.includes(sq(a)) || all.includes(sq(plain)) || missing.length === 0, `${tag} Q${q.n}: missing words ${missing.slice(0, 8).join(', ')} in "${a.slice(0, 50)}"`);
  }
  for (const [y, v] of Object.entries(d.form?.members ?? {})) check(`profile Membership: members ${y}`, seen.Membership.includes(sq(String(v))) || seen.Membership.includes(sq(num(v))), `${tag}: ${v}`);
  for (const doc of d.documents_list ?? []) check('profile Documents: every file is listed', seen.Documents.includes(sq(doc.name)), `${tag}: ${doc.name}`);
  void all;
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  for (let i = 0; i < 20 && (await ev("!!document.querySelector('[role=dialog]')")); i++) await sleep(150);
}
console.log(`Read in Chrome: Cohort 2 Overview, Cohort 2 Finalists (${table.length} rows), ${opened} finalist profiles opened, ${TABS.length} tabs each\n`);
chrome.kill();
const bad = report('Cohort 2 pages in the browser');
console.log(`
Form answers that differ from the spreadsheet (the page shows the spreadsheet value): ${notes.length}`); notes.slice(0, 60).forEach((n) => console.log('  ' + n));
process.exit(bad ? 1 : 0);
