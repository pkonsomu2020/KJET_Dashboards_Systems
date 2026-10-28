/**
 * report2-reconciliation.mjs: compares the "KJET C1 Co-investment Selection Report DRAFT271026" tables with the
 * dashboard's evaluation data, figure by figure. Read-only.
 *
 *   node tests/report2-reconciliation.mjs <tables.json>
 *
 * <tables.json> is the report's tables as { "Table 1": [[cell, ...], ...], ... } keyed by their captions.
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
const mean = (xs) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null);
const m1 = (v) => Math.round(v * 10) / 10;
const byApp = new Map(data.map((d) => [d.application_number, d]));
const fin = (d) => d.financial;
const payable = (d) => Math.min(fin(d).grant ?? 0, fin(d).max_eligible_grant ?? 0);
const winNo = (d) => (/^Window 1/.test(fin(d).category) ? '1' : /^Window 2/.test(fin(d).category) ? '2' : '-');
const BAND = { Recommended: 'Recommended', Referred: 'Referred with Comments', Rejected: 'Rejected' };

// ── Annex B: every cluster's score, band, window, eligibility and grant ──
const annex = [['Table 23', 'Recommended'], ['Table 24', 'Referred with Comments'], ['Table 25', 'Rejected']];
let seen = 0;
for (const [tk, band] of annex) {
  let last = Infinity;
  for (const r of rows(tk)) {
    const d = byApp.get(r[1]); seen++;
    if (!d) { cmp('Annex B', `${r[1]} exists`, 'listed', 'missing'); continue; }
    const id = `${d.cluster_name.slice(0, 26)}`;
    cmp('Annex B', `${id}: band`, band, d.band);
    cmp('Annex B', `${id}: score`, n(r[6]), d.score, 0.0001);
    cmp('Annex B', `${id}: county`, r[3], d.county);
    cmp('Annex B', `${id}: value chain`, r[4], d.value_chain);
    cmp('Annex B', `${id}: window`, r[5], winNo(d));
    cmp('Annex B', `${id}: eligibility`, r[7].toUpperCase(), String(d.eligibility).toUpperCase());
    cmp('Annex B', `${id}: grant`, n(r[8]), fin(d).grant, 0.5);
    if (n(r[6]) > last) cmp('Annex B', `${tk} order by score at ${id}`, 'descending', 'not');
    last = n(r[6]);
  }
}
cmp('Annex B', 'clusters listed', 85, seen);

// ── Table 1 / Table 14: decision bands ──
for (const [tk, cols] of [['Table 1', { n: 2, mean: 3, cost: 4, grant: 5 }], ['Table 14', { n: 1, mean: 3, cost: 4, grant: 5, pay: 6 }]]) {
  for (const r of rows(tk)) {
    const key = /^Recommended/.test(r[0]) ? 'Recommended' : /^Referred/.test(r[0]) ? 'Referred with Comments' : /^Rejected/.test(r[0]) ? 'Rejected' : null;
    if (!key) continue;
    const g = data.filter((d) => d.band === key);
    cmp(tk, `${key}: apps`, n(r[cols.n]), g.length);
    cmp(tk, `${key}: mean score`, n(r[cols.mean]), m1(mean(g.map((d) => d.score))));
    cmp(tk, `${key}: project cost (KES m)`, n(r[cols.cost]), m1(g.reduce((s, d) => s + (fin(d).total ?? 0), 0) / 1e6));
    cmp(tk, `${key}: grant (KES m)`, n(r[cols.grant]), m1(g.reduce((s, d) => s + (fin(d).grant ?? 0), 0) / 1e6));
    if (cols.pay) cmp(tk, `${key}: payable (KES m)`, n(r[cols.pay]), m1(g.reduce((s, d) => s + payable(d), 0) / 1e6));
  }
}

// ── Executive summary figures ──
const tot = data.reduce((s, d) => s + (fin(d).total ?? 0), 0) / 1e6, gr = data.reduce((s, d) => s + (fin(d).grant ?? 0), 0) / 1e6;
cmp('Summary', 'total project cost (KES m)', 2047.5, m1(tot));
cmp('Summary', 'grant requested (KES m)', 920.3, m1(gr));
cmp('Summary', 'payable after caps and 50% rule (KES m)', 881.6, m1(data.reduce((s, d) => s + payable(d), 0) / 1e6));
cmp('Summary', 'cohort mean score', 58.0, m1(mean(data.map((d) => d.score))));
const rec = data.filter((d) => d.band === 'Recommended');
cmp('Summary', 'recommended: own funds (KES m)', 571.7, m1(rec.reduce((s, d) => s + (fin(d).contribution ?? 0), 0) / 1e6));
cmp('Summary', 'recommended pool: counties', 20, new Set(rec.map((d) => d.county)).size);
cmp('Summary', 'recommended pool: value chains', 7, new Set(rec.map((d) => d.value_chain)).size);
for (const w of ['1', '2']) {
  const g = data.filter((d) => winNo(d) === w);
  cmp('Summary', `Window ${w}: applications`, w === '1' ? 35 : 50, g.length);
  cmp('Summary', `Window ${w}: grant (KES m)`, w === '1' ? 111.2 : 809.1, m1(g.reduce((s, d) => s + (fin(d).grant ?? 0), 0) / 1e6));
  cmp('Summary', `Window ${w}: mean score`, w === '1' ? 56.8 : 58.8, m1(mean(g.map((d) => d.score))));
}
cmp('Summary', 'recommended in Window 2', 16, rec.filter((d) => winNo(d) === '2').length);
cmp('Summary', 'recommended: all pass the cost-share rule', 22, rec.filter((d) => fin(d).result === 'PASS').length);

// ── Table 3 and 4: eligibility ──
for (const r of rows('Table 3')) {
  if (!/^E\d+$/.test(r[0])) continue;
  cmp('Table 3', `${r[0]} pass/hold/fail`, `${r[2]}/${r[3]}/${r[4]}`, ['Pass', 'Hold', 'Fail'].map((v) => data.filter((d) => d.tests[r[0]] === v).length).join('/'));
}
cmp('Table 4', 'eligible (PASS)', 11, data.filter((d) => d.eligibility === 'PASS').length);
cmp('Table 4', 'hold', 61, data.filter((d) => d.eligibility === 'HOLD').length);
cmp('Table 4', 'fail', 13, data.filter((d) => d.eligibility === 'FAIL').length);
for (const r of rows('Table 4')) {
  const el = r[0].toUpperCase();
  for (const [i, b] of [[1, 'Recommended'], [2, 'Referred with Comments'], [3, 'Rejected']]) cmp('Table 4', `${el} x ${b}`, n(r[i]), data.filter((d) => String(d.eligibility).toUpperCase() === el && d.band === b).length);
}

// ── Table 5 and the sub-indicator tables ──
const crit = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'];
for (const r of rows('Table 5')) {
  const c = crit.indexOf(r[0]); if (c < 0) continue;
  const rs = data.map((d) => d.criteria[c]);
  cmp('Table 5', `${r[0]} average rating`, n(r[3]), Math.round(mean(rs.map((x) => x.rating)) * 100) / 100, 0.0051);
  cmp('Table 5', `${r[0]} average points`, n(r[4]), m1(mean(rs.map((x) => x.score))));
}
const { rows: sub } = await pool.query('SELECT code, AVG(rating)::float av, COUNT(*) FILTER (WHERE rating <= 2)::int low FROM cluster_eval_criteria GROUP BY code');
const sm = new Map(sub.map((c) => [c.code, c]));
for (const tk of ['Table 6', 'Table 7', 'Table 8', 'Table 9', 'Table 10', 'Table 11']) {
  for (const r of rows(tk)) {
    const code = r[0].slice(0, 4); const c = sm.get(code); if (!c) continue;
    cmp(tk, `${code} average rating`, n(r[2]), Math.round(c.av * 100) / 100, 0.0051);
    cmp(tk, `${code} rated 2 or below`, n(/\((\d+) of/.exec(r[3])?.[1]), c.low);
  }
}

// ── Table 12 and 13: value chain and legal form ──
for (const r of rows('Table 12')) {
  const g = data.filter((d) => d.value_chain === r[0]); if (!g.length && !n(r[1])) continue;
  cmp('Table 12', `${r[0]}: apps`, n(r[1]), g.length);
  cmp('Table 12', `${r[0]}: mean score`, n(r[2]), m1(mean(g.map((d) => d.score))));
  cmp('Table 12', `${r[0]}: rec/ref/rej`, `${r[3]}/${r[4]}/${r[5]}`, ['Recommended', 'Referred with Comments', 'Rejected'].map((b) => g.filter((d) => d.band === b).length).join('/'));
  cmp('Table 12', `${r[0]}: grant (KES m)`, n(r[6]), m1(g.reduce((s, d) => s + (fin(d).grant ?? 0), 0) / 1e6));
}
for (const r of rows('Table 13')) {
  const g = data.filter((d) => d.legal_form === r[0]);
  cmp('Table 13', `${r[0]}: apps`, n(r[1]), g.length);
  cmp('Table 13', `${r[0]}: rec/ref/rej`, `${r[3]}/${r[4]}/${r[5]}`, ['Recommended', 'Referred with Comments', 'Rejected'].map((b) => g.filter((d) => d.band === b).length).join('/'));
}

// ── Table 15 and 17: the recommended pool ──
const recSorted = [...rec].sort((a, b) => a.rank - b.rank);
for (const r of rows('Table 15')) {
  const d = recSorted[n(r[0]) - 1]; if (!d) continue;
  cmp('Table 15', `#${r[0]} cluster`, r[1], d.cluster_name);
  cmp('Table 15', `#${r[0]} grant (KES m)`, n(r[6]), m1((fin(d).grant ?? 0) / 1e6));
}
for (const r of rows('Table 17')) {
  const w = /1/.test(r[0]) ? '1' : /2/.test(r[0]) ? '2' : null; if (!w) continue;
  const g = rec.filter((d) => winNo(d) === w);
  cmp('Table 17', `Window ${w}: clusters`, n(r[1]), g.length);
  cmp('Table 17', `Window ${w}: project cost (KES m)`, n(r[2]), m1(g.reduce((s, d) => s + (fin(d).total ?? 0), 0) / 1e6));
  cmp('Table 17', `Window ${w}: grant (KES m)`, n(r[4]), m1(g.reduce((s, d) => s + (fin(d).grant ?? 0), 0) / 1e6));
}

// ── output ──
const bad = results.filter((r) => !r.ok);
for (const g of [...new Set(results.map((r) => r.group))]) { const rs = results.filter((r) => r.group === g); console.log(`${rs.every((r) => r.ok) ? 'OK  ' : 'DIFF'}  ${g.padEnd(10)} ${rs.filter((r) => r.ok).length}/${rs.length} agree`); }
console.log(`\nTOTAL: ${results.length - bad.length} of ${results.length} agree, ${bad.length} differ\n`);
for (const b of bad) console.log(`[${b.group}] ${b.item}: report ${JSON.stringify(b.report)} | dashboard ${JSON.stringify(b.dash)}`);
await pool.end();
process.exit(0);
