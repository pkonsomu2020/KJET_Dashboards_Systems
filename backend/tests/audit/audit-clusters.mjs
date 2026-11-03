/**
 * audit-clusters.mjs: the Cohort 1 "Portfolio overview" and "Cluster profile" audit. Read-only.
 *
 *   node tests/audit/audit-clusters.mjs [http://localhost:4000 | https://kjet-dashboard.leadedgeconsults.com]
 *
 * The dashboard's API is compared with TWO sources the dashboard does not use to render anything here:
 *   1. the 85 application files in ATTACHMENTS/<application>_extracted/application_details.csv, read by a parser written
 *      for this audit (the app's own CSV reader is not used);
 *   2. the live online evaluation sheet (exported now), read by header name.
 * Then it recomputes every portfolio number (tiles, value chains, counties, matching review) from those two sources.
 */
import 'dotenv/config';
import { createRequire } from 'module';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { login, api, makeChecker, BASE } from './lib.mjs';
import { initDriveClient, getDriveClient } from '../../src/services/driveService.js';

const XLSX = createRequire(import.meta.url)('xlsx');
const ATT = resolve(process.env.ATTACHMENTS_DIR ?? '../ATTACHMENTS');
const { check: rawCheck, report } = makeChecker();
// applications whose file in the ATTACHMENTS folder is a different submission from the one the dashboard holds: their differences are reported apart
const stale = new Set();
let cur = null;
const check = (group, ok, detail) => rawCheck(!ok && cur && stale.has(cur) ? `DIFFERENT SUBMISSION, folder vs dashboard: ${group.replace(/^[a-z ]+: /, '')}` : group, ok, detail);

// ── 1. the application files, parsed independently ──────────────────────────────
const folders = readdirSync(ATT).filter((d) => d.endsWith('_extracted')).sort();
const rawFiles = new Map();
for (const f of folders) {
  const p = join(ATT, f, 'application_details.csv');
  if (existsSync(p)) rawFiles.set(f.replace('_extracted', ''), readFileSync(p, 'utf8').replace(/\r/g, '').split('\n'));
}
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const shape = (label) => label.replace(/\d+/g, '#');
// a line opens a field when its label is one the form really has: one that occurs in at least half of the files
const labelFreq = new Map();
for (const lines of rawFiles.values()) {
  const seen = new Set();
  for (const l of lines) { const m = l.match(/^([A-Za-z][^,]{0,70}),/); if (m) seen.add(shape(m[1])); }
  for (const s of seen) labelFreq.set(s, (labelFreq.get(s) ?? 0) + 1);
}
const DOC_LABELS = /^(Bank statements|Financial statements|Financial models|Lender letter|Technical specs|Supplier quotations|Bundled services docs|Buyer agreements)(\[\])?,/;
const isLabel = (l) => { if (DOC_LABELS.test(l)) return true; const m = l.match(/^([A-Za-z][^,]{0,70}),/); return !!m && (labelFreq.get(shape(m[1].replace(/\[\]$/, ''))) ?? 0) >= rawFiles.size / 2 || /^[A-Za-z ]+\[\],/.test(l); };
function parse(lines) {
  const m = new Map();
  let cur = null;
  for (const l of lines) {
    if (/^=== /.test(l)) cur = null;
    else if (isLabel(l)) { const i = l.indexOf(','); cur = l.slice(0, i).replace(/\[\]$/, ''); if (!m.has(cur)) m.set(cur, l.slice(i + 1)); else cur = null; }
    else if (cur) m.set(cur, `${m.get(cur)}\n${l}`);
  }
  return m;
}
const apps = new Map([...rawFiles].map(([a, lines]) => [a, parse(lines)]));
const T = (f, label) => norm(f.get(label));
const N = (f, label) => { const v = norm(f.get(label)).replace(/,/g, ''); return v === '' || isNaN(Number(v)) ? null : Number(v); };

// ── 2. the live evaluation sheet ────────────────────────────────────────────────
await initDriveClient();
const drive = getDriveClient();
const sheetId = process.env.EVALUATION_SHEET_ID;
const { data: meta } = await drive.files.get({ fileId: sheetId, fields: 'name,modifiedTime', supportsAllDrives: true });
const wb = XLSX.read(Buffer.from((await drive.files.export({ fileId: sheetId, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, { responseType: 'arraybuffer' })).data), { type: 'buffer' });
const grid = (name) => XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
const col = (head, name) => { const i = head.findIndex((h) => norm(h).startsWith(name)); if (i < 0) throw new Error(`column "${name}" not found`); return i; };
const byApp = (rows, c) => new Map(rows.slice(5).filter((r) => String(r[c]).startsWith('KJET-')).map((r) => [String(r[c]).trim(), r]));
const sc = grid('SCORECARD'), fs = grid('Financial_Screening'), rg = grid('Register');
const sCol = { app: col(sc[4], 'Application No.'), county: col(sc[4], 'County'), chain: col(sc[4], 'Value chain'), total: col(sc[4], 'TOTAL SCORE') };
const fCol = { app: col(fs[4], 'Application No.'), total: col(fs[4], 'Total investment (Evaluation'), contrib: col(fs[4], 'Cluster contribution (Evaluation'), grant: col(fs[4], 'KJET matching contribution (Evaluation'), s5: col(fs[4], 'Section 5 budget total (portal)'), mach: col(fs[4], 'Machinery subtotal (portal)'), serv: col(fs[4], 'Services subtotal (portal)') };
const rCol = { app: col(rg[4], 'Application No.'), men: col(rg[4], 'Members – men'), women: col(rg[4], 'Members – women'), youth: col(rg[4], 'Members – youth'), pwd: col(rg[4], 'Members – PWD') };
const sheetSC = byApp(sc, sCol.app), sheetFS = byApp(fs, fCol.app), sheetRG = byApp(rg, rCol.app);
const sv = (v) => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));
console.log(`Evaluation sheet "${meta.name}", modified ${meta.modifiedTime}: ${sheetSC.size} clusters in SCORECARD, ${sheetFS.size} in Financial_Screening, ${sheetRG.size} in Register`);
console.log(`Application files: ${apps.size} read from ${ATT}\n`);

// ── 3. the dashboard ────────────────────────────────────────────────────────────
// the API allows 200 requests per 15 minutes: AUDIT_CACHE=<file> keeps what was read so a re-run needs none
const cacheFile = process.env.AUDIT_CACHE;
let live = cacheFile && existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : null;
if (!live) {
  const cookie = await login();
  live = {
    list: await api('/api/clusters?limit=100&sort=name', cookie),
    summary: (await api('/api/portfolio/summary', cookie)).data,
    byChain: (await api('/api/portfolio/by-chain', cookie)).data,
    byCounty: (await api('/api/portfolio/by-county', cookie)).data,
    compliance: (await api('/api/portfolio/compliance', cookie)).data,
    detail: {},
  };
  const ids = live.list.data.map((c) => c.application_number); let i = 0;
  const work = async () => { while (i < ids.length) { const a = ids[i++]; live.detail[a] = (await api(`/api/clusters/${a}`, cookie)).data; } };
  await Promise.all([work(), work(), work(), work()]);
  if (cacheFile) (await import('fs')).writeFileSync(cacheFile, JSON.stringify(live));
}
const { list, summary, byChain, byCounty, compliance } = live;
const detail = new Map(Object.entries(live.detail));
console.log(`Dashboard (${BASE}): ${list.total} clusters in the list, ${detail.size} profiles read\n`);

for (const [a, f] of apps) {
  const d = detail.get(a); if (!d) continue;
  const fileWhen = new Date(`${T(f, 'Submitted At').replace(' ', 'T')}+03:00`).getTime();
  if (T(f, 'Status') !== d.status || Math.abs(fileWhen - new Date(d.submitted_at).getTime()) > 1000) stale.add(a);
}
console.log(`${stale.size} applications whose file in the ATTACHMENTS folder is a different submission (status or submitted-at) from the one the dashboard holds:`);
for (const a of stale) console.log(`  ${a} ${detail.get(a)?.cluster_name}: dashboard ${detail.get(a)?.status} ${String(detail.get(a)?.submitted_at).slice(0, 10)} / folder ${T(apps.get(a), 'Status')} ${T(apps.get(a), 'Submitted At').slice(0, 10)}`);
console.log('');
check('same 85 applications in the dashboard and in the attachment folders', [...apps.keys()].sort().join() === [...detail.keys()].sort().join(), `attachments-only: ${[...apps.keys()].filter((a) => !detail.has(a))}; dashboard-only: ${[...detail.keys()].filter((a) => !apps.has(a))}`);
check('same 85 applications in the dashboard and in the evaluation sheet', [...sheetSC.keys()].sort().join() === [...detail.keys()].sort().join(), `sheet-only: ${[...sheetSC.keys()].filter((a) => !detail.has(a))}; dashboard-only: ${[...detail.keys()].filter((a) => !sheetSC.has(a))}`);

// ── 4. Cluster profile: every field the profile shows, against the application file ─────
const day = (v) => (v == null ? '' : String(v).slice(0, 10));
const same = (have, want) => {
  const h = norm(have), w = norm(want);
  if (h === w) return true;
  if (h !== '' && w !== '' && !isNaN(Number(h)) && !isNaN(Number(w))) return Math.abs(Number(h) - Number(w)) < 0.005;
  return false;
};
const field = (group, a, have, want) => check(group, same(have, want), `${a}: dashboard=${JSON.stringify(have)} file=${JSON.stringify(want)}`);
const bool = (v) => (/^(yes|true|1)$/i.test(norm(v)) ? 'true' : 'false');

for (const [a, f] of apps) {
  const d = detail.get(a); if (!d) continue;
  cur = a;
  const t = (l) => T(f, l), n = (l) => N(f, l);
  const g = (grp, have, label) => field(`profile identity: ${grp}`, a, have, t(label));
  g('name', d.cluster_name, 'Cluster name'); g('organisation', d.organization_name, 'Organization Name');
  g('legal form', d.legal_form, 'Cluster legal form'); g('status', d.status, 'Status');
  check('profile identity: registration date', day(d.registration_date) === t('Cluster registration date'), `${a}: ${d.registration_date} vs ${t('Cluster registration date')}`);
  g('address', d.physical_address, 'Cluster physical address'); g('county', d.county, 'Cluster county');
  g('constituency', d.constituency, 'Constituency'); g('ward', d.ward, 'Ward'); g('value chain', d.value_chain, 'Value Chain');
  g('phone', d.phone, 'Cluster phone'); g('email', d.email, 'Cluster email'); g('insurance', d.insurance, 'Cluster insurance');
  g('signatories', d.signatories, 'Cluster signatories'); g('executives ownership', d.executives_ownership, 'Executives ownership');
  g('prior funding', d.prior_funding, 'Prior funding'); g('vision', d.vision, 'Cluster vision'); g('mission', d.mission, 'Cluster mission');
  for (let i = 1; i <= 5; i++) g(`goal ${i}`, d[`goal_${i}`], `Goal ${i}`);
  check('profile identity: current applications', bool(d.current_applications) === bool(t('Current applications')), `${a}: ${d.current_applications} vs ${t('Current applications')}`);
  g('current applications details', d.current_applications_detail, 'Current applications details');
  g('county on the application header equals the cluster county', t('County'), 'Cluster county');

  const m = (grp, have, label) => field(`profile membership: ${grp}`, a, have, n(label));
  m('men', d.men, 'Total members men'); m('women', d.women, 'Total members women'); m('youth', d.youth, 'Total members youth'); m('pwd', d.pwd, 'Total members pwd');
  field('profile membership: total = men + women', a, d.total_members, (n('Total members men') ?? 0) + (n('Total members women') ?? 0));

  const $ = (grp, have, label) => field(`profile money: ${grp}`, a, have, n(label));
  // the amounts follow the evaluation sheet (Financial_Screening); the application's where the sheet has none
  const sh = (k) => sv(sheetFS.get(a)?.[fCol[k]]);
  const hasSheet = sh('total') != null;
  const $s = (grp, have, key, label) => field(`profile money: ${grp}`, a, have, hasSheet && sh(key) != null ? sh(key) : n(label));
  $s('total project cost', d.total_project_cost, 'total', 'Total project cost'); $s('machinery subtotal', d.machinery_subtotal, 'mach', 'Machinery subtotal');
  $s('services subtotal', d.services_subtotal, 'serv', 'Services subtotal'); $s('cluster contribution', d.cluster_contribution, 'contrib', 'Cluster contribution');
  $s('grant requested', d.grant_requested, 'grant', 'Grant requested'); $s('section 5 budget', d.section5_budget_total, 's5', 'Budget total');
  const tot = hasSheet ? sh('total') : n('Total project cost');
  const cashX = hasSheet && sh('contrib') != null ? sh('contrib') : n('Cluster contribution'), grantX = hasSheet && sh('grant') != null ? sh('grant') : n('Grant requested');
  if (tot) {
    check('profile money: cluster share %', Math.abs(Number(d.cluster_share_pct) - (cashX / tot) * 100) < 0.01, `${a}: ${d.cluster_share_pct} vs ${(cashX / tot) * 100}`);
    check('profile money: grant share %', Math.abs(Number(d.grant_share_pct) - (grantX / tot) * 100) < 0.01, `${a}: ${d.grant_share_pct} vs ${(grantX / tot) * 100}`);
  }
  for (const [k, l] of [['productive_assets', 'Budget productive assets'], ['services', 'Budget services'], ['working_capital', 'Budget working capital'], ['land_buildings', 'Budget land buildings'], ['preop_expenses', 'Budget preop expenses']]) {
    $(`budget ${k}`, d[`budget_${k}`], l); $(`budget ${k} %`, d[`budget_${k}_pct`], `${l} pct`);
  }
  $('payback', d.payback_period_years, 'Machinery payback period'); $('IRR', d.irr_pct, 'Machinery irr'); $('NPV', d.npv_kes, 'Machinery npv');
  field('profile money: payback notes', a, d.payback_period_notes, t('Machinery payback period notes'));
  field('profile money: IRR notes', a, d.irr_notes, t('Machinery irr notes')); field('profile money: NPV notes', a, d.npv_notes, t('Machinery npv notes'));
  for (let i = 1; i <= 5; i++) field(`profile money: key assumption ${i}`, a, d[`key_assumption_${i}`], t(`Key assumption ${i}`));
  for (const k of ['implementation_timeline', 'problem_addressed', 'without_grant_alternative', 'why_now']) {
    const label = { implementation_timeline: 'Implementation timeline', problem_addressed: 'Problem addressed', without_grant_alternative: 'Without grant alternative', why_now: 'Why now' }[k];
    field(`profile application text: ${k}`, a, d[k], t(label));
  }
  field('profile application text: capacity ability explanation', a, d.capacity_ability_explanation, t('Capacity ability explanation'));

  // jobs and income
  for (const [k, l] of [['jobs_today', 'Jobs today'], ['jobs_year1', 'Jobs year1'], ['jobs_year3', 'Jobs year3'],
    ['jobs_women_today', 'Jobs women today'], ['jobs_women_year1', 'Jobs women year1'], ['jobs_women_year3', 'Jobs women year3'],
    ['jobs_youth_today', 'Jobs youth today'], ['jobs_youth_year1', 'Jobs youth year1'], ['jobs_youth_year3', 'Jobs youth year3'],
    ['jobs_pwd_today', 'Jobs pwd today'], ['jobs_pwd_year1', 'Jobs pwd year1'], ['jobs_pwd_year3', 'Jobs pwd year3'],
    ['income_today', 'Income today'], ['income_year1', 'Income year1'], ['income_year3', 'Income year3']]) {
    const want = n(l), have = d[k] == null || d[k] === '' ? null : Math.round(Number(d[k]));
    check(`profile jobs and income: ${l}`, (want == null && have == null) || (want != null && have != null && Math.abs(have - Math.round(want)) <= 0), `${a}: dashboard=${d[k]} file=${want}`);
  }
  field('profile jobs and income: assumptions', a, d.income_assumptions, t('Jobs income assumptions'));

  // contacts, bank
  const person = (type) => (d.contacts ?? []).find((x) => x.contact_type === type) ?? {};
  for (const [type, pre] of [['authorized', 'Authorized'], ['manager', 'Project manager']]) {
    const p = person(type);
    field(`profile governance: ${type} name`, a, p.full_name, t(`${pre} name`)); field(`profile governance: ${type} position`, a, p.position, t(`${pre} position`));
    field(`profile governance: ${type} id number`, a, p.id_number, t(`${pre} id number`)); field(`profile governance: ${type} phone`, a, p.phone, t(`${pre} phone`));
    field(`profile governance: ${type} email`, a, p.email, t(`${pre} email`));
  }
  field('profile governance: bank name', a, d.banking?.bank_name, t('Cluster bank name')); field('profile governance: bank account', a, d.banking?.bank_account, t('Cluster bank account'));
  field('profile governance: declaration name', a, d.declaration_name, t('Authorized declaration name')); field('profile governance: declaration position', a, d.declaration_position, t('Authorized declaration position'));
  check('profile governance: declaration date', day(d.declaration_date) === t('Authorized declaration date'), `${a}: ${d.declaration_date} vs ${t('Authorized declaration date')}`);

  // business and market
  const b = d.business ?? {};
  for (const [k, l] of [['market_geography', 'Market geography'], ['market_size', 'Market size'], ['competitor_1', 'Competitor 1'], ['competitor_2', 'Competitor 2'], ['competitor_3', 'Competitor 3'],
    ['pricing_method', 'Pricing method'], ['production_process', 'Production process'], ['installed_capacity', 'Installed capacity'], ['installed_capacity_unit', 'Installed capacity unit'],
    ['current_output', 'Current output'], ['current_output_unit', 'Current output unit'], ['capacity_utilisation_pct', 'Capacity utilisation'], ['main_bottleneck', 'Main bottleneck']]) {
    field(`profile business: ${k}`, a, b[k], t(l));
  }
  field('profile business: sustainability plan', a, d.sustainability?.sustainability_plan, t('Sustainability plan'));

  // rows: machinery, services, products, buyers
  const rows = (prefix, keys) => { const out = []; for (let i = 1; i <= 200; i++) { const r = {}; let any = false; for (const [k, l] of keys) { const v = f.get(`${prefix} ${i} ${l}`); if (v !== undefined && norm(v) !== '') any = true; r[k] = v; } if (any) out.push({ i, ...r }); } return out; };
  const cmpRows = (group, haveRows, wantRows, keys, orderKey) => {
    check(`profile rows: ${group} count`, haveRows.length === wantRows.length, `${a}: dashboard=${haveRows.length} file=${wantRows.length}`);
    const mine = [...haveRows].sort((x, y) => x[orderKey] - y[orderKey]);
    wantRows.forEach((w, idx) => { const h = mine[idx]; if (!h) return; for (const [hk, wk] of keys) field(`profile rows: ${group} ${wk}`, a, h[hk], w[wk]); });
  };
  cmpRows('machinery', d.machinery ?? [], rows('Machinery', [['desc', 'desc'], ['qty', 'qty'], ['unit', 'unit cost'], ['total', 'total cost']]).filter((r) => norm(r.desc) !== '' || Number(r.total || 0) !== 0),
    [['description', 'desc'], ['quantity', 'qty'], ['unit_cost_kes', 'unit'], ['total_cost_kes', 'total']], 'item_order');
  cmpRows('services', d.services ?? [], rows('Service', [['desc', 'desc'], ['qty', 'qty'], ['unit', 'unit cost'], ['total', 'total cost']]).filter((r) => norm(r.desc) !== '' || Number(r.total || 0) !== 0),
    [['description', 'desc'], ['quantity', 'qty'], ['unit_cost_kes', 'unit'], ['total_cost_kes', 'total']], 'item_order');
  cmpRows('products', d.products ?? [], rows('Product', [['name', 'name'], ['unit', 'unit'], ['price', 'price'], ['months', 'months']]).filter((r) => norm(r.name) !== ''),
    [['product_name', 'name'], ['unit', 'unit'], ['price_kes', 'price'], ['active_months', 'months']], 'product_order');
  cmpRows('buyers', d.buyers ?? [], rows('Buyer', [['name', 'name'], ['type', 'type'], ['volume', 'volume'], ['price', 'price'], ['years', 'years']]).filter((r) => norm(r.name) !== ''),
    [['buyer_name', 'name'], ['buyer_type', 'type'], ['annual_volume', 'volume'], ['unit_price', 'price'], ['contract_years', 'years']], 'buyer_order');

  // profit and loss, balance sheet, cash flow
  for (const y of [1, 2, 3]) {
    const row = (d.pl ?? []).find((x) => Number(x.year) === y);
    for (const [k, l] of [['revenue', 'revenue'], ['cogs', 'cogs'], ['gross_profit', 'gross profit'], ['salaries', 'salaries'], ['rent', 'rent'], ['marketing', 'marketing'], ['other_opex', 'other opex'], ['ebitda', 'ebitda'], ['depreciation', 'depreciation'], ['net_profit', 'net profit']]) {
      for (const w of ['with', 'without']) {
        const want = f.get(`Pl ${l} y${y} ${w}`);
        if (norm(want) === '' && !row) continue;
        field(`profile P&L: ${l} ${w}`, a, row?.[`${k}_${w}`], want);
      }
    }
    const bs = (d.balancesheet ?? []).find((x) => Number(x.year) === y);
    for (const [k, l] of [['asset_cash', 'asset cash'], ['asset_receivables', 'asset receivables'], ['asset_inventory', 'asset inventory'], ['asset_fixed_assets_net', 'asset fixed assets net'], ['liab_payables', 'liab payables'], ['liab_loans', 'liab loans'], ['equity_members_contrib', 'equity members contributions'], ['equity_retained_earnings', 'equity retained earnings']]) {
      const want = f.get(`Balance y${y} ${l}`); if (norm(want) === '' && !bs) continue;
      field(`profile balance sheet: ${l}`, a, bs?.[k], want);
    }
    for (let mo = 1; mo <= 12; mo++) {
      const cf = (d.cashflow ?? []).find((x) => Number(x.year) === y && Number(x.month) === mo);
      for (const [k, l] of [['opening_cash_balance', 'opening cash balance'], ['sales_inflows', 'sales inflows'], ['equipment_payments', 'equipment payments'], ['closing_cash_balance', 'closing cash balance']]) {
        const want = f.get(`Cashflow y${y} ${l} m${mo}`); if (norm(want) === '' && !cf) continue;
        field(`profile cash flow: ${l}`, a, cf?.[k], want);
      }
    }
  }
  // impact
  const im = d.impact ?? {};
  for (const [k, l] of [['daily_output_today', 'Daily output today'], ['daily_output_after', 'Daily output after'], ['daily_output_pct', 'Daily output percent'], ['reject_rate_today', 'Reject rate today'], ['reject_rate_after', 'Reject rate after'],
    ['sales_uplift_y1_revenue', 'Sales uplift y1 revenue'], ['sales_uplift_y2_revenue', 'Sales uplift y2 revenue'], ['sales_uplift_y3_revenue', 'Sales uplift y3 revenue'], ['sales_uplift_y1_units', 'Sales uplift y1 units']]) {
    const want = f.get(l); if (norm(want) === '' && im[k] == null) continue; field(`profile impact: ${l}`, a, im[k], want);
  }
  // risks: every risk with a likelihood in the file is listed once, with its likelihood, impact and mitigation
  const rget = (base, k) => { const lines = rawFiles.get(a); const i = lines.findIndex((x) => x.startsWith(`${base} ${k},`)); if (i < 0) return ''; let out = lines[i].slice(base.length + k.length + 2); for (let j = i + 1; j < lines.length && !/^[A-Z][A-Za-z ]+( \d+)?( [a-z]+)?,/.test(lines[j]) && !/^===/.test(lines[j]); j++) out += ' ' + lines[j]; return out; };
  const wantRisk = rawFiles.get(a).filter((l) => /^Risk .+ likelihood,.+/.test(l)).map((l) => l.slice(0, l.indexOf(' likelihood,'))).map((base) => `${norm(rget(base, 'likelihood')).toLowerCase()}|${norm(rget(base, 'impact')).toLowerCase()}|${norm(rget(base, 'mitigation'))}`).sort();
  const haveRisk = (d.risks ?? []).filter((r) => r.likelihood != null && norm(r.likelihood) !== '').map((r) => `${norm(r.likelihood).toLowerCase()}|${norm(r.impact).toLowerCase()}|${norm(r.mitigation)}`).sort();
  check('profile risks: the same risks, with likelihood, impact and mitigation', haveRisk.join('\n') === wantRisk.join('\n'), `${a}: dashboard=${haveRisk.length} file=${wantRisk.length}`);
}

cur = null;
// ── 5. Cluster profile: the Appendices tab (documents) against the attachment folders ─────
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
const stripStamp = (n) => n.replace(/^\d{8,}_[0-9a-f]{8,}_/, '');
let localFiles = 0, apiFiles = 0;
for (const [a] of apps) {
  const d = detail.get(a); if (!d) continue;
  const local = walk(join(ATT, `${a}_extracted`)).map((p) => p.slice(join(ATT, `${a}_extracted`).length + 1).replace(/\\/g, '/')).filter((p) => !/^(DOWNLOAD_REPORT\.txt)$/.test(p));
  localFiles += local.length; apiFiles += (d.documents ?? []).length;
  const key = (n) => stripStamp(n).replace(/\.[A-Za-z0-9]{2,5}$/, '').toLowerCase();   // the dashboard lists the Drive name, which can lack the extension
  const localNames = local.filter((p) => !/DOWNLOAD_REPORT/i.test(p)).map((p) => key(p.split('/').pop())).sort();
  const apiNames = (d.documents ?? []).filter((x) => !/DOWNLOAD_REPORT/i.test(x.original_filename)).map((x) => key(x.original_filename)).sort();
  const count = (xs) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map());
  const lc = count(localNames), ac = count(apiNames);
  const onlyLocal = [...lc].filter(([k, v]) => v > (ac.get(k) ?? 0)).map(([k]) => k), onlyApi = [...ac].filter(([k, v]) => v > (lc.get(k) ?? 0)).map(([k]) => k);
  check('appendices: every file in the attachment folder is listed in the dashboard', onlyLocal.length === 0, `${a}: not in dashboard: ${onlyLocal.slice(0, 3).join(' | ')}`);
  check('appendices: every file the dashboard lists is in the attachment folder', onlyApi.length === 0, `${a}: not in folder: ${onlyApi.slice(0, 3).join(' | ')}`);
}
console.log(`Files: ${localFiles} in the attachment folders (the download report excluded), ${apiFiles} listed by the dashboard\n`);

// ── 6. Portfolio overview: every number recomputed from the application files and the live sheet ─────
const useSheet = (a, k) => sv(sheetFS.get(a)?.[fCol[k]]);
const acc = { cost: 0, grant: 0, contribution: 0, budget: 0, members: 0, women: 0, men: 0, youth: 0, pwd: 0, j0: 0, j1: 0, j3: 0, excluded: [] };
const chainOf = (a) => { const raw = norm(sheetSC.get(a)?.[sCol.chain]) || T(apps.get(a), 'Value Chain'); const x = raw.toLowerCase(); return x.startsWith('dairy') ? 'Dairy' : x.startsWith('construction') ? 'Construction Materials' : x.replace(/_/g, ' ').startsWith('edible oil') ? 'Edible Oils' : x.startsWith('textile') ? 'Textiles' : 'Other'; };
const chains = new Map(), counties = new Map();
let within = 0, review = 0, missing = 0;
for (const [a, f] of apps) {
  const cost = useSheet(a, 'total') ?? N(f, 'Total project cost') ?? 0, grant = useSheet(a, 'grant') ?? N(f, 'Grant requested') ?? 0;
  const contribution = useSheet(a, 'contrib') ?? N(f, 'Cluster contribution') ?? 0, budget = useSheet(a, 's5') ?? N(f, 'Budget total') ?? 0;
  acc.cost += cost; acc.grant += grant; acc.contribution += contribution; acc.budget += budget;
  const rg1 = sheetRG.get(a);
  const men = sv(rg1?.[rCol.men]) ?? N(f, 'Total members men') ?? 0, women = sv(rg1?.[rCol.women]) ?? N(f, 'Total members women') ?? 0;
  acc.men += men; acc.women += women; acc.members += men + women;
  acc.youth += sv(rg1?.[rCol.youth]) ?? N(f, 'Total members youth') ?? 0; acc.pwd += sv(rg1?.[rCol.pwd]) ?? N(f, 'Total members pwd') ?? 0;
  const j = [N(f, 'Jobs today'), N(f, 'Jobs year1'), N(f, 'Jobs year3')];
  if (Math.max(...j.map((x) => x ?? 0)) <= 5000) { acc.j0 += j[0] ?? 0; acc.j1 += j[1] ?? 0; acc.j3 += j[2] ?? 0; } else acc.excluded.push(a);
  const ch = chainOf(a); const c = chains.get(ch) ?? { count: 0, cost: 0, grant: 0, contribution: 0 };
  c.count++; c.cost += cost; c.grant += grant; c.contribution += contribution; chains.set(ch, c);
  const county = T(f, 'Cluster county'); const k = counties.get(county) ?? { count: 0, cost: 0, grant: 0 };
  k.count++; k.cost += cost; k.grant += grant; counties.set(county, k);
  // the matching review runs on the same amounts as the totals: the sheet's, else the application's
  const ct = useSheet(a, 'total') != null ? cost : N(f, 'Total project cost'), gr = useSheet(a, 'total') != null ? grant : N(f, 'Grant requested'), cc = useSheet(a, 'total') != null ? contribution : N(f, 'Cluster contribution');
  if (!ct) missing++; else if (gr > 32000000 || gr > ct * 0.5 || cc < ct * 0.5) review++; else within++;
}
const near = (a, b, tol = 0.5) => Math.abs(Number(a) - Number(b)) <= tol;
check('overview tiles: total clusters', Number(summary.count) === apps.size, `${summary.count} vs ${apps.size}`);
check('overview tiles: counties covered', Number(summary.counties) === counties.size, `${summary.counties} vs ${counties.size}`);
for (const [k, l] of [['cost', 'cost'], ['grant', 'grant'], ['contribution', 'contribution'], ['budget', 'budget'], ['members', 'members'], ['women', 'women'], ['men', 'men'], ['youth', 'youth'], ['pwd', 'pwd']]) {
  check(`overview tiles: ${l}`, near(summary[k], acc[k]), `dashboard=${summary[k]} recomputed=${acc[k]}`);
}
check('overview tiles: jobs today', near(summary.jobs_today, acc.j0), `${summary.jobs_today} vs ${acc.j0}`);
check('overview tiles: jobs year 1', near(summary.jobs_year1, acc.j1), `${summary.jobs_year1} vs ${acc.j1}`);
check('overview tiles: jobs year 3', near(summary.jobs_year3, acc.j3), `${summary.jobs_year3} vs ${acc.j3}`);
check('overview tiles: applications left out of the jobs totals', Number(summary.jobs_excluded_count) === acc.excluded.length && acc.excluded.every((a) => (summary.jobs_excluded ?? []).some((x) => x.application_number === a)), `${summary.jobs_excluded_count} vs ${acc.excluded}`);
check('overview: matching review, within limits', Number(summary.within_limits) === within, `${summary.within_limits} vs ${within}`);
check('overview: matching review, review required', Number(summary.reviews) === review, `${summary.reviews} vs ${review}`);
check('overview: matching review, missing financials', Number(summary.missing) === missing, `${summary.missing} vs ${missing}`);
check('overview: compliance endpoint agrees with the tiles', (compliance.find((x) => x.compliance_status === 'Review required')?.count ?? 0) == review, JSON.stringify(compliance));
check('overview: value chains, same groups', byChain.map((x) => x.name).sort().join() === [...chains.keys()].sort().join(), `${byChain.map((x) => x.name)} vs ${[...chains.keys()]}`);
for (const r of byChain) {
  const c = chains.get(r.name); if (!c) continue;
  check(`overview: value chain ${r.name}`, Number(r.count) === c.count && near(r.cost, c.cost) && near(r.grant, c.grant) && near(r.contribution, c.contribution), `dashboard=${r.count}/${r.cost}/${r.grant}/${r.contribution} recomputed=${c.count}/${c.cost}/${c.grant}/${c.contribution}`);
}
check('overview: value chain counts add up to 85', byChain.reduce((s, x) => s + Number(x.count), 0) === apps.size, '');
check('overview: counties, same list', byCounty.map((x) => x.name).sort().join() === [...counties.keys()].sort().join(), `${byCounty.map((x) => x.name).sort()} vs ${[...counties.keys()].sort()}`);
for (const r of byCounty) {
  const c = counties.get(r.name); if (!c) continue;
  check('overview: county totals', Number(r.count) === c.count && near(r.cost, c.cost) && near(r.grant, c.grant), `${r.name}: dashboard=${r.count}/${r.cost}/${r.grant} recomputed=${c.count}/${c.cost}/${c.grant}`);
}
check('overview: county order is by cost, highest first', byCounty.every((r, i) => i === 0 || Number(byCounty[i - 1].cost) >= Number(r.cost)), '');
// the county the dashboard shows is the application's; the evaluation sheet's county should be the same
for (const [a, row] of sheetSC) check('overview: county in the application = county in the evaluation sheet', norm(row[sCol.county]).toLowerCase() === T(apps.get(a), 'Cluster county').toLowerCase(), `${a}: application=${T(apps.get(a), 'Cluster county')} sheet=${norm(row[sCol.county])}`);

// ── 7. the list on the Cluster profile page ─────────────────────────────────────
for (const r of list.data) {
  const d = detail.get(r.application_number);
  check('cluster list = cluster profile (name, county, chain, money, members, jobs)', ['cluster_name', 'county', 'value_chain', 'total_project_cost', 'grant_requested', 'cluster_contribution', 'total_members', 'jobs_year3'].every((k) => same(r[k], d[k])), `${r.application_number}: ${['cluster_name', 'county', 'value_chain', 'total_project_cost', 'grant_requested', 'cluster_contribution', 'total_members', 'jobs_year3'].filter((k) => !same(r[k], d[k])).map((k) => `${k}: list=${r[k]} profile=${d[k]}`)}`);
}

const bad = report('Portfolio overview and Cluster profile');
console.log(`\nRecomputed from the files and the sheet: cost ${acc.cost}, grant ${acc.grant}, contribution ${acc.contribution}, budget ${acc.budget}, members ${acc.members}, jobs year 3 ${acc.j3}`);
process.exit(bad ? 1 : 0);
