/**
 * report-reconciliation.js: compares the "KJET C1 Co-investment Selection Report" (a .docx) with the
 * dashboard's data, number by number. Read-only.
 *
 *   node tests/report-reconciliation.js <tables.json>
 *
 * <tables.json> is the report's tables dumped as { "Table 5": [[cell, ...], ...], "Annex B": [...] }.
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import pool from '../src/db/pool.js';
import { getEvaluationList } from '../src/services/evaluationService.js';

const T = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const { data } = await getEvaluationList();
const n = (s) => { const v = Number(String(s ?? '').replace(/[,%\s]/g, '').replace(/^–$/, '')); return Number.isFinite(v) ? v : null; };
const rows = (k) => (T[k] ?? []).slice(1);

const results = [];
const same = (a, b, tol) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= tol : String(a) === String(b));
const cmp = (group, item, report, dash, tol = 0.05) => results.push({ group, item, report, dash, ok: same(report, dash, tol) });

// ── dashboard-side figures ──
const { rows: fin } = await pool.query(`SELECT c.application_number a, c.legal_form lf, f.total_project_cost t, f.cluster_contribution cc, f.grant_requested g,
  m.total_members tm, m.women w, m.youth y, m.pwd p FROM clusters c LEFT JOIN cluster_financials f ON f.cluster_id=c.id LEFT JOIN cluster_membership m ON m.cluster_id=c.id`);
const F = new Map(fin.map((r) => [r.a, r]));
const sum = (arr, fn) => arr.reduce((s, x) => s + (fn(x) ?? 0), 0);
const M = 1e6;
// amounts and members come from each cluster application (application_details.csv)
const D = data.map((d) => ({ ...d, f: { ...F.get(d.application_number), t: d.financial.total, cc: d.financial.contribution, g: d.financial.grant } }));
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const winOf = (d) => ({ 'Window 1 (Growth Window)': '1', 'Window 2 (Transformational Window)': '2', 'Above the Window 2 ceiling': 'C', 'Invalid grant (zero or less)': 'X' }[d.financial.category] ?? '?');
const bandKey = (b) => ({ Recommended: 'Rec', 'Referred with Comments': 'Ref', Rejected: 'Rej' }[b] ?? b);

// ── Annex B: every application ──
const annex = rows('Annex B');
const repScreen = (s) => ({ Pass: 'PASS', 'Data error': 'FOLLOW-UP: data error', Documents: 'FOLLOW-UP: documents', 'Exceeds cap': 'FOLLOW-UP: exceeds cap', 'Below 50%': 'NON-COMPLIANT: <50% cash' }[s] ?? s);
const byApp = new Map(D.map((d) => [d.application_number, d]));
let screenDiffs = [], grantDiffs = [], winDiffs = [];
for (const r of annex) {
  const [rank, app, , , , win, score, band, elig, grant, screen] = r;
  const d = byApp.get(app);
  if (!d) { cmp('Annex B', `${app} exists`, 'listed', 'missing'); continue; }
  cmp('Annex B', `${app} score`, n(score), d.score, 0.01);
  cmp('Annex B', `${app} band`, band, bandKey(d.band));
  cmp('Annex B', `${app} eligibility`, elig.toUpperCase(), d.eligibility);
  const g = d.f?.g == null ? null : Math.round((Number(d.f.g) / M) * 100) / 100;
  if (g == null || Math.abs(g - n(grant)) > 0.011) grantDiffs.push(`${d.cluster_name.slice(0, 26)}: report ${grant} vs dashboard ${g}`);
  if (win !== winOf(d)) winDiffs.push(`${d.cluster_name.slice(0, 26)}: report ${win} vs dashboard ${winOf(d)}`);
  if (screen && !/pass/i.test(screen) !== (d.financial.result !== 'PASS')) screenDiffs.push(`${d.cluster_name.slice(0, 26)}: report ${screen} vs dashboard ${d.financial.result}`);
  else if (screen && /pass/i.test(screen) && d.financial.result !== 'PASS') screenDiffs.push(`${d.cluster_name.slice(0, 26)}: report ${screen} vs dashboard ${d.financial.result}`);
}
cmp('Annex B', 'applications listed', annex.length, 85);
cmp('Annex B', 'grant (KES m) equals the evaluation figures', 85 - grantDiffs.length, 85);
cmp('Annex B', 'window equals the category from Drive', 85 - winDiffs.length, 85);
cmp('Annex B', 'screening result equals the dashboard', 85 - screenDiffs.length, 85);

// ── rank order: the report ranks all 85 by score ──
const order = [...D].sort((a, b) => (b.score - a.score) || ((b.criteria[1].score ?? 0) - (a.criteria[1].score ?? 0)) || ((b.criteria[0].score ?? 0) - (a.criteria[0].score ?? 0)) || ((b.criteria[5].score ?? 0) - (a.criteria[5].score ?? 0)));
const repOrder = annex.map((r) => r[1]);
cmp('Annex B', 'rank order of all 85 (same position)', repOrder.filter((a, i) => order[i]?.application_number === a).length, 85, 4);

// ── Table 1 / 12 / 14: counts ──
const cnt = (fn) => D.filter(fn).length;
const t1 = Object.fromEntries(rows('Table 1').map((r) => [r[0], n(r[1])]));
cmp('Table 1', 'applications evaluated', t1['Applications evaluated and scored'], D.length);
cmp('Table 1', 'passed eligibility', t1['Passed eligibility (E1 to E10)'], cnt((d) => d.eligibility === 'PASS'));
cmp('Table 1', 'on eligibility hold', t1['On eligibility hold'], cnt((d) => d.eligibility === 'HOLD'));
cmp('Table 1', 'failed eligibility', t1['Failed eligibility'], cnt((d) => d.eligibility === 'FAIL'));
cmp('Table 1', 'scored 70 or above', t1['Scored 70 or above'], cnt((d) => d.band === 'Recommended'));
cmp('Table 1', 'scored 50 to 69', t1['Scored 50 to 69'], cnt((d) => d.band === 'Referred with Comments'));
cmp('Table 1', 'scored below 50', t1['Scored below 50'], cnt((d) => d.band === 'Rejected'));
cmp('Table 1', 'eligible and 70+', t1['Eligible and scored 70 or above'], cnt((d) => d.eligibility === 'PASS' && d.band === 'Recommended'));
cmp('Table 1', '70+ but on hold', t1['Scored 70 or above but on eligibility hold'], cnt((d) => d.eligibility === 'HOLD' && d.band === 'Recommended'));
cmp('Table 1', 'passed financial screening', t1['Passed financial screening'], cnt((d) => d.financial.result === 'PASS'));
const sheetPass = (await pool.query("SELECT COUNT(*)::int c FROM cluster_evaluation WHERE financial_screening = 'PASS'")).rows[0].c;
cmp('Table 1', 'passed financial screening (per the sheet itself)', t1['Passed financial screening'], sheetPass);

// ── Table 2: totals ──
const t2 = Object.fromEntries(rows('Table 2').map((r) => [r[0], r[1]]));
const tot = (fn) => sum(D, (d) => (d.f ? Number(fn(d.f) ?? 0) : 0));
cmp('Table 2', 'total project cost (KES m)', n(/([\d,.]+) million/.exec(t2['Total project cost'])?.[1]), Math.round((tot((f) => f.t) / M) * 10) / 10, 0.06);
cmp('Table 2', 'cluster contribution (KES m)', n(/KES ([\d,.]+) million/.exec(t2['Cluster contribution'])?.[1]), Math.round((tot((f) => f.cc) / M) * 10) / 10, 0.06);
cmp('Table 2', 'KJET grant requested (KES m)', n(/([\d,.]+) million/.exec(t2['KJET grant requested'])?.[1]), Math.round((tot((f) => f.g) / M) * 10) / 10, 0.06);
const mem = /([\d,]+) members, of whom ([\d,]+) .*? and ([\d,]+) youth; ([\d,]+) persons/.exec(t2['Membership recorded']);
cmp('Table 2', 'members', n(mem?.[1]), tot((f) => f.tm), 0.5);
cmp('Table 2', 'women', n(mem?.[2]), tot((f) => f.w), 0.5);
cmp('Table 2', 'youth', n(mem?.[3]), tot((f) => f.y), 0.5);
cmp('Table 2', 'persons with disability', n(mem?.[4]), tot((f) => f.p), 0.5);
const lf = (k) => cnt((d) => d.legal_form === k);
cmp('Table 2', 'legal form cooperatives', 41, lf('cooperative'));
cmp('Table 2', 'legal form companies', 30, lf('company'));
cmp('Table 2', 'legal form self-help groups', 8, lf('shg'));
cmp('Table 2', 'legal form other', 6, lf('other'));
const w = (k) => cnt((d) => winOf(d) === k);
cmp('Table 2', 'window 1 count', 31, w('1')); cmp('Table 2', 'window 2 count', 45, w('2')); cmp('Table 2', 'above ceiling count', 4, w('C')); cmp('Table 2', 'invalid grant count', 5, w('X'));

// ── Table 5: windows ──
for (const [row, key] of [['Window 1 (Category 1)', '1'], ['Window 2 (Category 2)', '2'], ['Above the Window 2 ceiling', 'C'], ['Invalid grant (zero or less)', 'X']]) {
  const r = rows('Table 5').find((x) => x[0] === row); const g = D.filter((d) => winOf(d) === key);
  cmp('Table 5', `${row}: applications`, n(r[1]), g.length);
  cmp('Table 5', `${row}: grant (KES m)`, n(r[2]), Math.round((sum(g, (d) => Number(d.f?.g ?? 0)) / M) * 10) / 10, 0.06);
  cmp('Table 5', `${row}: project cost (KES m)`, n(r[3]), Math.round((sum(g, (d) => Number(d.f?.t ?? 0)) / M) * 10) / 10, 0.06);
  cmp('Table 5', `${row}: mean score`, n(r[5]), Math.round(mean(g.map((d) => d.score)) * 10) / 10, 0.06);
}

// ── Table 10: financial screening results ──
const t10 = Object.fromEntries(rows('Table 10').map((r) => [r[0].replace(/[–—-]/g, '-').replace(/\s+/g, ' ').toLowerCase(), n(r[1])]));
const fr = (k) => cnt((d) => d.financial.result === k);
cmp('Table 10', 'pass', t10['pass - no finding'], fr('PASS'));
cmp('Table 10', 'data error', t10['follow-up - data error'], fr('FOLLOW-UP: data error'));
cmp('Table 10', 'documents', t10['follow-up - documents'], fr('FOLLOW-UP: documents'));
cmp('Table 10', 'exceeds ceiling', t10['follow-up - exceeds the window ceiling'], fr('FOLLOW-UP: exceeds cap'));
cmp('Table 10', 'below 50% cash', t10['non-compliant - below 50% cash contribution'], fr('NON-COMPLIANT: <50% cash'));
cmp('Table 10', 'clusters meeting 50% cash (Section 3.7: 63)', 63, cnt((d) => d.financial.meets_50_percent_cash));

// ── Tables 12-14: eligibility ──
const t13 = rows('Table 13');
for (const r of t13) {
  const t = r[0];
  cmp('Table 13', `${t} pass`, n(r[2]), cnt((d) => d.tests[t] === 'Pass'));
  cmp('Table 13', `${t} hold`, n(r[3]), cnt((d) => d.tests[t] === 'Hold'));
  cmp('Table 13', `${t} fail`, n(r[4]), cnt((d) => d.tests[t] === 'Fail'));
}
const t14 = rows('Table 14');
for (const [i, e] of [[0, 'PASS'], [1, 'HOLD'], [2, 'FAIL']]) {
  cmp('Table 14', `${e} / 70+`, n(t14[i][1]), cnt((d) => d.eligibility === e && d.band === 'Recommended'));
  cmp('Table 14', `${e} / 50-69`, n(t14[i][2]), cnt((d) => d.eligibility === e && d.band === 'Referred with Comments'));
  cmp('Table 14', `${e} / below 50`, n(t14[i][3]), cnt((d) => d.eligibility === e && d.band === 'Rejected'));
}

// ── Table 17: bands ──
for (const [row, b] of [['Recommended (70+)', 'Recommended'], ['Referred with comments (50-69)', 'Referred with Comments'], ['Rejected (below 50)', 'Rejected']]) {
  const r = rows('Table 17').find((x) => x[0] === row); const g = D.filter((d) => d.band === b);
  cmp('Table 17', `${row}: apps`, n(r[1]), g.length);
  cmp('Table 17', `${row}: mean score`, n(r[3]), Math.round(mean(g.map((d) => d.score)) * 10) / 10, 0.06);
  cmp('Table 17', `${row}: grant (KES m)`, n(r[4]), Math.round((sum(g, (d) => Number(d.f?.g ?? 0)) / M) * 10) / 10, 0.06);
  cmp('Table 17', `${row}: project cost (KES m)`, n(r[5]), Math.round((sum(g, (d) => Number(d.f?.t ?? 0)) / M) * 10) / 10, 0.06);
}
cmp('Table 17', 'cohort mean score', 56.5, Math.round(mean(D.map((d) => d.score)) * 10) / 10, 0.06);

// ── Table 18: criteria ──
for (const r of rows('Table 18').filter((x) => /^C\d$/.test(x[0]))) {
  const i = Number(r[0][1]) - 1;
  cmp('Table 18', `${r[0]} average rating`, n(r[3]), Math.round(mean(D.map((d) => d.criteria[i].rating)) * 100) / 100, 0.011);
  cmp('Table 18', `${r[0]} average points`, n(r[4]), Math.round(mean(D.map((d) => d.criteria[i].score)) * 10) / 10, 0.06);
}

// ── Tables 20 and 21: value chain and legal form ──
const core = { Dairy: 'Dairy', 'Construction Materials': 'Construction', 'Edible Oils': 'Edible oils', Textiles: 'Textiles' };
const chainOf = (d) => { const v = String(d.value_chain).toLowerCase(); return v.startsWith('dairy') ? 'Dairy' : v.startsWith('construction') ? 'Construction Materials' : v.startsWith('edible') ? 'Edible Oils' : v.startsWith('textile') ? 'Textiles' : 'All other chains'; };
for (const r of rows('Table 20')) {
  if (r[0] === 'Total') continue;
  const g = D.filter((d) => chainOf(d) === r[0]);
  cmp('Table 20', `${r[0]}: apps`, n(r[1]), g.length);
  cmp('Table 20', `${r[0]}: mean score`, n(r[2]), Math.round(mean(g.map((d) => d.score)) * 10) / 10, 0.06);
  cmp('Table 20', `${r[0]}: rec/ref/rej`, `${r[3]}/${r[4]}/${r[5]}`, `${g.filter((d) => d.band === 'Recommended').length}/${g.filter((d) => d.band === 'Referred with Comments').length}/${g.filter((d) => d.band === 'Rejected').length}`);
  cmp('Table 20', `${r[0]}: grant (KES m)`, n(r[6]), Math.round((sum(g, (d) => Number(d.f?.g ?? 0)) / M) * 10) / 10, 0.06);
}
const lfKey = { 'Cooperative society': 'cooperative', 'Limited company': 'company', 'Self-help group': 'shg', 'Other registered body': 'other' };
for (const r of rows('Table 21')) {
  const g = D.filter((d) => d.legal_form === lfKey[r[0]]);
  cmp('Table 21', `${r[0]}: apps`, n(r[1]), g.length);
  cmp('Table 21', `${r[0]}: mean score`, n(r[2]), Math.round(mean(g.map((d) => d.score)) * 10) / 10, 0.06);
  cmp('Table 21', `${r[0]}: rec/ref/rej`, `${r[3]}/${r[4]}/${r[5]}`, `${g.filter((d) => d.band === 'Recommended').length}/${g.filter((d) => d.band === 'Referred with Comments').length}/${g.filter((d) => d.band === 'Rejected').length}`);
}

// ── Annex C: sub-indicator averages ──
const { rows: crit } = await pool.query('SELECT code, AVG(rating)::float av, COUNT(*) FILTER (WHERE rating <= 2)::int low, COUNT(*) FILTER (WHERE rating = 0)::int zero FROM cluster_eval_criteria GROUP BY code');
const cm = new Map(crit.map((c) => [c.code, c]));
for (const r of T[Object.keys(T).find((k) => k.startsWith('untitled39'))].slice(1)) {
  const code = r[0].slice(0, 4); const c = cm.get(code);
  cmp('Annex C', `${code} average rating`, n(r[2]), Math.round(c.av * 100) / 100, 0.011);
  cmp('Annex C', `${code} rated 2 or below`, n(/\((\d+)\)/.exec(r[3])?.[1]), c.low);
  cmp('Annex C', `${code} rated 0`, n(r[4]), c.zero);
}

// ── output ──
const bad = results.filter((r) => !r.ok);
const groups = [...new Set(results.map((r) => r.group))];
for (const g of groups) { const rs = results.filter((r) => r.group === g); console.log(`${rs.every((r) => r.ok) ? 'OK  ' : 'DIFF'}  ${g.padEnd(10)} ${rs.filter((r) => r.ok).length}/${rs.length} agree`); }
console.log(`\nTOTAL: ${results.length - bad.length} of ${results.length} agree, ${bad.length} differ\n`);
for (const b of bad) console.log(`[${b.group}] ${b.item}: report ${JSON.stringify(b.report)} | dashboard ${JSON.stringify(b.dash)}`);
if (grantDiffs.length) console.log('\nGrant differs (Annex B vs Drive):\n  ' + grantDiffs.join('\n  '));
if (winDiffs.length) console.log('\nWindow differs:\n  ' + winDiffs.join('\n  '));
if (screenDiffs.length) console.log('\nScreening differs:\n  ' + screenDiffs.join('\n  '));
await pool.end();
process.exit(0);
