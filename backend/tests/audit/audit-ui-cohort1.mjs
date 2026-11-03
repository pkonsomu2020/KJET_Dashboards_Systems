/**
 * audit-ui-cohort1.mjs: reads what the three Cohort 1 pages SHOW in a real browser (headless Chrome) and compares it with the data.
 * Needs the app running (frontend 5173, backend 4000). Read-only.
 *
 *   node tests/audit/audit-ui-cohort1.mjs <finalists json from audit-finalists1> <cache json from audit-clusters>
 */
import 'dotenv/config';
import { spawn } from 'child_process';
import { readFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { makeChecker } from './lib.mjs';

const { check, report } = makeChecker();
const fin = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const live = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FRONT = process.env.UI_FRONT ?? 'http://localhost:5173', API = process.env.UI_API ?? 'http://localhost:4000';
const login = await fetch(`${API}/api/auth/sign-in/email`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: FRONT }, body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }) });
const cookies = login.headers.getSetCookie().map((c) => { const [nv] = c.split(';'); const i = nv.indexOf('='); return { name: nv.slice(0, i), value: nv.slice(i + 1) }; });
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--remote-debugging-port=9340', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'kjetaudit-'))}`, '--window-size=1500,1000', 'about:blank'], { stdio: 'ignore' });
let tabs; for (let i = 0; i < 30; i++) { try { tabs = await (await fetch('http://127.0.0.1:9340/json')).json(); if (tabs.length) break; } catch { /* starting */ } await sleep(500); }
const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl); await new Promise((res) => { ws.onopen = res; });
let id = 0; const pend = new Map(); ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Page.enable'); await send('Network.enable');
for (const c of cookies) await send('Network.setCookie', { name: c.name, value: c.value, domain: 'localhost', path: '/' });
await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });
const go = async (path, ready) => { await send('Page.navigate', { url: FRONT + path }); for (let i = 0; i < 90; i++) { if (await ev(`!!document.querySelector(${JSON.stringify(ready)})`)) break; await sleep(1000); } await sleep(1200); };
const press = (sel, text) => ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.textContent.trim().startsWith(${JSON.stringify(text)})); if (!e) return false; for (const t of ['mousedown','mouseup','click']) e.dispatchEvent(new MouseEvent(t, { bubbles: true })); return true; })()`);
const body = () => ev('document.body.innerText');
const num = (v) => new Intl.NumberFormat('en-KE').format(v);
const money = (v) => (v >= 1e9 ? `KES ${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `KES ${(v / 1e6).toFixed(2)}M` : `KES ${num(Math.round(v))}`);
const flat = (s) => String(s).replace(/\s+/g, ' ');

// ── 1. Portfolio overview ──
await go('/cohort-1/overview', '.metrics-grid .metric');
const S = live.summary; let t = flat(await body());
const has = (group, text) => check(group, t.includes(text), `expected "${text}" on the page`);
has('overview tile: total clusters', `${S.count}`); has('overview tile: counties', `${S.counties} counties`);
has('overview tile: total project cost', money(Number(S.cost))); has('overview tile: matching grant', money(Number(S.grant)));
has('overview tile: cluster cash', money(Number(S.contribution))); has('overview tile: members', num(Number(S.members)));
has('overview tile: women', `${num(Number(S.women))} women (${(Number(S.women) / Number(S.members) * 100).toFixed(1)}%)`);
has('overview tile: men', `${num(Number(S.men))} men (${(Number(S.men) / Number(S.members) * 100).toFixed(1)}%)`);
has('overview tile: youth', `${num(Number(S.youth))} youth (${(Number(S.youth) / Number(S.members) * 100).toFixed(1)}%)`);
has('overview tile: jobs year 3', num(Number(S.jobs_year3)));
has('overview tile: matching grant % of cost', `${(Number(S.grant) / Number(S.cost) * 100).toFixed(1)}% of cost`);
has('overview tile: cash % of cost', `${(Number(S.contribution) / Number(S.cost) * 100).toFixed(1)}% of cost`);
has('overview co-investment: sectors represented', `${live.byChain.length} sectors`);
has('overview co-investment: section 5 budget', money(Number(S.budget)));
for (const c of live.byChain.slice(0, 5)) has('overview co-investment: value chain in the legend', c.name.replace(/_/g, ' '));
await press('[role=tab]', 'Jobs'); await sleep(900); t = flat(await body());
for (const [l, k] of [['Women', 'women'], ['Men', 'men'], ['Youth', 'youth'], ['Persons with disabilities', 'pwd']]) has(`overview inclusion: ${l}`, `${l} ${num(Number(S[k]))}`);
await press('[role=tab]', 'County'); await sleep(900); t = flat(await body());
has('overview counties: national reach', `${S.counties} / 47 counties`);
for (const c of live.byCounty) has('overview counties: every county with its clusters and cost', `${c.name} ${c.count} clusters ${money(Number(c.cost))}`);
await press('[role=tab]', 'Matching'); await sleep(900); t = flat(await body());
has('overview matching: review count', `${S.reviews} applications require matching-rule review; ${S.missing} have missing project costs`);
has('overview matching: within limits', `${Number(S.count) - Number(S.reviews) - Number(S.missing)} Within limits`);
has('overview matching: review required', `${S.reviews} Review required`); has('overview matching: missing financials', `${S.missing} Missing financials`);

// ── 2. Cohort 1 Finalists ──
await go('/cohort-1/finalists', '.fn-table tbody tr');
const table = await ev(`[...document.querySelectorAll('.fn-table tbody tr')].map((tr) => ({ name: tr.querySelector('.cluster-name')?.childNodes[0]?.textContent.trim(), id: tr.querySelector('.cluster-id')?.textContent.trim(), county: tr.children[1].textContent.trim(), ratings: [...tr.querySelectorAll('.fn-rate strong')].map((s) => s.childNodes[0].textContent.trim()), comp: tr.children[8]?.querySelector('strong')?.textContent.trim(), sub: tr.children[8]?.querySelector('.gr-sub')?.textContent.trim() }))`);
check('finalists page: 90 rows', table.length === 90, String(table.length));
for (const f of fin.rows) {
  const row = table.find((x) => x.id === (f.application_id ?? `Applicant ${f.applicant_id}`));
  check('finalists page: a row for every finalist', !!row, `${f.applicant_id} ${f.cluster_name}`);
  if (!row) continue;
  check('finalists page: county', row.county === f.county, `${f.applicant_id}: ${row.county} vs ${f.county}`);
  check('finalists page: six ratings', row.ratings.join() === f.criteria.map((c) => c.rating ?? '-').join(), `${f.applicant_id}: ${row.ratings} vs ${f.criteria.map((c) => c.rating)}`);
  check('finalists page: composite score', Number(row.comp) === Number(f.composite), `${f.applicant_id}: ${row.comp} vs ${f.composite}`);
  check('finalists page: tier and rank', (row.sub ?? '').startsWith(`${f.tier ?? 'No tier'} · rank ${f.rank ?? '-'}`), `${f.applicant_id}: ${row.sub} vs ${f.tier} rank ${f.rank}`);
  check('finalists page: name', (row.name ?? '').toLowerCase().includes((f.cluster_name ?? '').toLowerCase().slice(0, 12)), `${f.applicant_id}: ${row.name} vs ${f.cluster_name}`);
}

// ── 3. Cluster profile: the list of cards ──
await go('/clusters', '.fit-table tbody tr');
const seen = new Map(); let pages = 0;
for (let p = 0; p < 12; p++) {
  const cards = await ev(`[...document.querySelectorAll('.fit-table tbody tr')].map((c) => c.innerText.replace(/\\s+/g, ' '))`);
  for (const c of cards) { const m = c.match(/KJET-\d{4}-\d+/); if (m) seen.set(m[0], c); }
  pages++;
  const next = await ev(`(() => { const b = document.querySelector('button[aria-label="Next page"]'); if (!b || b.disabled) return false; b.click(); return true; })()`);
  if (!next) break; await sleep(1500);
}
check('cluster page: 85 clusters across the pages', seen.size === 85, `${seen.size} in ${pages} pages`);
for (const [a, text] of seen) {
  const d = live.detail[a]; if (!d) continue;
  check('cluster card: name', flat(text).toLowerCase().includes(flat(d.cluster_name).toLowerCase()), `${a}: ${JSON.stringify(d.cluster_name)} in ${text.slice(0, 120)}`);
  check('cluster card: county', text.includes(d.county), `${a}: ${d.county}`);
  check('cluster card: project cost', text.includes(money(Number(d.total_project_cost))), `${a}: ${money(Number(d.total_project_cost))} in "${text.slice(0, 160)}"`);
  check('cluster card: members', text.includes(num(Number(d.total_members))), `${a}: ${d.total_members}`);
  check('cluster card: grant and cash shares', text.includes(`${Number(d.grant_share_pct).toFixed(1)}% / ${Number(d.cluster_share_pct).toFixed(1)}%`), `${a}: ${Number(d.grant_share_pct).toFixed(1)}% / ${Number(d.cluster_share_pct).toFixed(1)}%`);
  check('cluster card: section 5 budget', text.includes(`S5: ${money(Number(d.section5_budget_total))}`), a);
  if (Number(d.total_members) > 0) check('cluster card: women and youth share', text.includes(`${(Number(d.women) / Number(d.total_members) * 100).toFixed(1)}% women`) && text.includes(`${(Number(d.youth) / Number(d.total_members) * 100).toFixed(1)}% youth`), a);
}

// ── 4. Cluster profile: every cluster's drawer, tab by tab ──
const tabList = [['Overview', 'overview'], ['Financial plan', 'financials'], ['Membership and jobs', 'inclusion'], ['Governance', 'governance']];
let opened = 0;
const ids = [...seen.keys()];
for (let k = 0; k < ids.length; k++) {
  const a = ids[k]; const d = live.detail[a];
  if (k % 15 === 0) await go('/clusters', '.fit-table tbody tr');
  let clicked = false;
  for (let attempt = 0; attempt < 3 && !clicked; attempt++) {
    if (attempt > 0) await go('/clusters', '.fit-table tbody tr');
    await ev(`(() => { const i = document.querySelector('input[aria-label="Global portfolio search"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(a)}); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    for (let i = 0; i < 30; i++) { if (await ev(`document.querySelectorAll('.fit-table tbody tr').length === 1 && document.querySelector('.fit-table tbody tr').innerText.includes(${JSON.stringify(a)})`)) break; await sleep(300); }
    clicked = await ev(`(() => { const c = [...document.querySelectorAll('.fit-table tbody tr')].find((x) => x.innerText.includes(${JSON.stringify(a)})); const b = c && c.querySelector('button'); if (!b) return false; b.click(); return true; })()`);
  }
  check('profile: opens from its card', clicked, a); if (!clicked) continue;
  for (let i = 0; i < 60; i++) { if (await ev(`(document.querySelector('.profile-sheet')?.innerText ?? '').includes(${JSON.stringify(a)}) && !!document.querySelector('.profile-sheet [role=tab]')`)) break; await sleep(300); }
  opened++;
  const pt = {};
  for (const [label, key] of tabList) { await press('.profile-sheet [role=tab]', label); await sleep(350); pt[key] = flat(await ev(`document.querySelector('.profile-sheet')?.innerText ?? ''`)); }
  const w = (tab, group, text) => check(`profile ${tab}: ${group}`, pt[tab].includes(flat(text)), `${a}: expected "${text}"`);
  w('overview', 'name', d.cluster_name); w('overview', 'application number', a); w('overview', 'county and constituency', `${d.county} · ${d.constituency}`);
  for (const [l, v] of [['Legal form', d.legal_form], ['Ward', d.ward], ['Value chain', d.value_chain], ['Application status', d.status]]) if (v) w('overview', l, String(v).slice(0, 28));
  for (const k2 of ['jobs_today', 'jobs_year1', 'jobs_year3']) w('overview', k2, num(Number(d[k2] ?? 0)));
  for (const [l, v] of [['total project cost', d.total_project_cost], ['section 5 budget', d.section5_budget_total], ['matching grant requested', d.grant_requested], ['cluster cash contribution', d.cluster_contribution]]) w('financials', l, money(Number(v)));
  w('financials', 'grant share', `Grant: ${Number(d.grant_share_pct).toFixed(1)}%`); w('financials', 'cash share', `Cluster cash: ${Number(d.cluster_share_pct).toFixed(1)}%`); w('financials', 'compliance status', d.compliance_status);
  for (const y of d.pl ?? []) w('financials', `year ${y.year} revenue`, money(Number(y.revenue_with)));
  for (const [l, v] of [['men', d.men], ['women', d.women], ['youth', d.youth], ['pwd', d.pwd], ['total', d.total_members]]) w('inclusion', `members ${l}`, num(Number(v ?? 0)));
  for (const c of d.contacts ?? []) { if (c.full_name) w('governance', `${c.contact_type} name`, c.full_name); if (c.phone) w('governance', `${c.contact_type} phone`, c.phone); }
  if (d.banking?.bank_name) w('governance', 'bank name', d.banking.bank_name);
  if (d.banking?.bank_account) w('governance', 'bank account', d.banking.bank_account);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  for (let i = 0; i < 20; i++) { if (!(await ev(`!!document.querySelector('.profile-sheet')`))) break; await sleep(250); }
}
console.log(`Read in Chrome: Portfolio overview (4 tabs), Cohort 1 Finalists (${table.length} rows), Cluster profile (${seen.size} cards, ${opened} profiles opened, ${tabList.length} tabs each)\n`);
const bad = report('What the three pages show');
chrome.kill(); process.exit(bad ? 1 : 0);
