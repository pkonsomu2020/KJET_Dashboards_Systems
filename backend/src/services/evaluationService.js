/**
 * evaluationService.js
 *
 * Serves the evaluation: scores and findings from the evaluation workbook (online sheet), amounts and
 * the 50-50 checks from the application data synced from Drive. Names of assessors and reviewers are
 * never read or returned.
 */
import pool from '../db/pool.js';
import { cacheGet, cacheSet } from '../cache/redis.js';
import { screenFinancials, RULES } from './financialScreening.js';
import { getEvaluationSheetStatus } from './evaluationSheet.js';
import { splitCriterionNotes, splitEligibilityNotes } from './evaluationNotes.js';

const TTL = Number(process.env.CACHE_TTL_EVALUATION) || 60;

const CRITERIA = [
  { code: 'C1', label: 'Overall cluster performance and viability', weight: 20 },
  { code: 'C2', label: 'Machinery investment viability', weight: 40 },
  { code: 'C3', label: 'Implementation capacity', weight: 15 },
  { code: 'C4', label: 'Relevant past experience', weight: 10 },
  { code: 'C5', label: 'Leadership and management experience', weight: 10 },
  { code: 'C6', label: 'Women or youth ownership and operation', weight: 5 },
];

const FROM = `
  FROM cluster_evaluation ev
  JOIN clusters c ON c.application_number = ev.application_number
  LEFT JOIN cluster_financials f ON f.cluster_id = c.id
  LEFT JOIN cluster_membership m ON m.cluster_id = c.id
  LEFT JOIN cluster_employment e ON e.cluster_id = c.id`;

const BASE = `
  ev.application_number, c.cluster_name, c.county, c.constituency, c.value_chain, c.legal_form,
  ev.category, ev.eligibility, ev.total_score, ev.band, ev.rank, ev.county_rank,
  ev.c1_rating, ev.c1_score, ev.c2_rating, ev.c2_score, ev.c3_rating, ev.c3_score,
  ev.c4_rating, ev.c4_score, ev.c5_rating, ev.c5_score, ev.c6_rating, ev.c6_score,
  ev.fs_doc_check, ev.financial_screening AS workbook_financial_result,
  f.total_project_cost, f.grant_requested, f.cluster_contribution,
  f.machinery_subtotal AS machinery_total, f.services_subtotal AS services_total,
  m.total_members, m.women, m.youth, m.pwd, e.jobs_today, e.jobs_year3`;

function screenRow(r) {
  return screenFinancials({
    total: r.total_project_cost, contribution: r.cluster_contribution, grant: r.grant_requested,
    machinery: r.machinery_total, services: r.services_total,
  }, { docCheck: r.fs_doc_check });
}

const n = (v) => (v == null ? null : Number(v));

function shapeRow(r, tests) {
  const fin = screenRow(r);
  return {
    application_number: r.application_number, cluster_name: r.cluster_name, county: r.county, constituency: r.constituency,
    value_chain: r.value_chain, legal_form: r.legal_form,
    score: n(r.total_score), band: r.band, rank: r.rank, county_rank: r.county_rank,
    eligibility: r.eligibility,
    criteria: CRITERIA.map((c, i) => ({ code: c.code, weight: c.weight, rating: n(r[`c${i + 1}_rating`]), score: n(r[`c${i + 1}_score`]) })),
    tests,
    financial: { result: fin.result, category: fin.category, issues: fin.issues, sheet_result: r.workbook_financial_result ?? null, ...fin.checks, ...fin.figures },
    members: n(r.total_members), women: n(r.women), youth: n(r.youth), pwd: n(r.pwd), jobs_today: n(r.jobs_today), jobs_year3: n(r.jobs_year3),
  };
}

async function testsByCluster() {
  const { rows } = await pool.query('SELECT application_number, test, decision FROM cluster_eval_eligibility ORDER BY application_number, test');
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.application_number)) map.set(r.application_number, {});
    map.get(r.application_number)[r.test] = r.decision;
  }
  return map;
}

/** Every evaluated cluster, with the scores, eligibility test outcomes and the screening worked out from Drive. */
export async function getEvaluationList() {
  const key = 'evaluation:list';
  const cached = await cacheGet(key);
  if (cached) return { ...cached, cached: true };
  const [{ rows }, tests, { rows: [meta] }] = await Promise.all([
    pool.query(`SELECT ${BASE} ${FROM} ORDER BY ev.total_score DESC NULLS LAST, c.cluster_name`),
    testsByCluster(),
    pool.query('SELECT MAX(source_file) AS source_file, MAX(imported_at) AS imported_at, COUNT(*)::int AS evaluated FROM cluster_evaluation'),
  ]);
  const result = { data: rows.map((r) => shapeRow(r, tests.get(r.application_number) ?? {})), meta: { ...meta, sheet: getEvaluationSheetStatus() }, rules: RULES, criteria: CRITERIA };
  await cacheSet(key, result, TTL);
  return { ...result, cached: false };
}

const countBy = (arr, fn) => arr.reduce((m, x) => { const k = fn(x); m[k] = (m[k] ?? 0) + 1; return m; }, {});

/** Portfolio-level picture: the funnel, bands, score spread, counties, value chains and where clusters fall short. */
export async function getEvaluationOverview(countyFilter = '') {
  const all = await getEvaluationList();
  // only a county that exists is accepted, so the cache cannot be filled with arbitrary keys
  const county = all.data.some((d) => d.county === countyFilter) ? countyFilter : '';
  const key = `evaluation:overview:${county}`;
  const cached = await cacheGet(key);
  if (cached) return { ...cached, cached: true };
  const data = county ? all.data.filter((d) => d.county === county) : all.data;
  const meta = { ...all.meta, evaluated: data.length };

  const passFin = data.filter((d) => d.financial.result === 'PASS');
  const passElig = data.filter((d) => d.eligibility === 'PASS');
  const recommended = data.filter((d) => d.band === 'Recommended');
  const avg = (xs) => (xs.length ? Math.round((xs.reduce((s, v) => s + v, 0) / xs.length) * 10) / 10 : null);

  const testIds = Array.from({ length: 10 }, (_, i) => `E${i + 1}`);
  const { rows: labels } = await pool.query('SELECT DISTINCT test, label FROM cluster_eval_eligibility ORDER BY test');
  const labelOf = Object.fromEntries(labels.map((l) => [l.test, l.label]));
  const tests = testIds.map((t) => ({
    test: t, label: labelOf[t] ?? t,
    pass: data.filter((d) => d.tests[t] === 'Pass').length,
    hold: data.filter((d) => d.tests[t] === 'Hold').length,
    fail: data.filter((d) => d.tests[t] === 'Fail').length,
  }));

  const group = (field) => Object.entries(countBy(data, (d) => d[field] ?? 'Not stated')).map(([name, count]) => {
    const rows = data.filter((d) => (d[field] ?? 'Not stated') === name);
    return {
      name, count, average_score: avg(rows.map((d) => d.score).filter((v) => v != null)),
      eligible: rows.filter((d) => d.eligibility === 'PASS').length,
    };
  }).sort((a, b) => b.count - a.count);

  const buckets = ['0-9', '10-19', '20-29', '30-39', '40-49', '50-59', '60-69', '70-79', '80-89', '90-100'].map((label, i) => ({
    label, count: data.filter((d) => d.score != null && Math.min(9, Math.floor(d.score / 10)) === i).length,
  }));

  const issueLabel = (t) => (/cash share/.test(t) ? 'Cluster cash below the 50% minimum'
    : /above the maximum eligible/.test(t) ? 'Grant above the maximum eligible grant'
      : /machinery plus services/.test(t) ? 'Total differs from machinery plus services'
        : /contribution plus grant/.test(t) ? 'Total differs from contribution plus grant' : t);
  const issueCounts = countBy(data.flatMap((d) => d.financial.issues.map(issueLabel)), (t) => t);

  const result = {
    funnel: [
      { stage: 'Evaluated', count: data.length },
      { stage: 'Financial screening: pass', count: passFin.length },
      { stage: 'Eligibility: pass', count: passElig.length },
      { stage: 'Score 70 or more', count: recommended.length },
    ],
    bands: Object.entries(countBy(data, (d) => d.band ?? 'Not scored')).map(([band, count]) => ({ band, count })),
    eligibility: Object.entries(countBy(data, (d) => d.eligibility ?? 'Not assessed')).map(([status, count]) => ({ status, count })),
    financial_results: Object.entries(countBy(data, (d) => d.financial.result)).map(([result, count]) => ({ result, count })).sort((a, b) => b.count - a.count),
    categories: Object.entries(countBy(data, (d) => d.financial.category)).map(([category, count]) => ({ category, count })),
    cash_shortfall_clusters: data.filter((d) => d.financial.meets_50_percent_cash === false).length,
    score_distribution: buckets,
    average_score: avg(data.map((d) => d.score).filter((v) => v != null)),
    criteria_average: CRITERIA.map((c, i) => ({ code: c.code, label: c.label, weight: c.weight, average: avg(data.map((d) => d.criteria[i].score).filter((v) => v != null)) })),
    tests,
    counties: group('county'),
    value_chains: group('value_chain'),
    top_issues: Object.entries(issueCounts).map(([issue, count]) => ({ issue, count })).sort((a, b) => b.count - a.count).slice(0, 8),
    county,
    meta,
  };
  await cacheSet(key, result, TTL);
  return { ...result, cached: false };
}

/** Everything about one cluster's evaluation: all 22 ratings, E1-E10 with reasons, the screening, and the Drive figures. */
export async function getEvaluationDetail(applicationNumber) {
  const app = String(applicationNumber ?? '').trim();
  const { rows } = await pool.query(`SELECT ${BASE}, ev.c1_evidence, ev.c2_evidence, ev.c3_evidence, ev.c4_evidence, ev.c5_evidence, ev.c6_evidence,
      ev.eligibility_reasons, ev.evidence_ids, ev.fs_note, ev.fs_issues, ev.fs_category, ev.expert_remarks, ev.source_file, ev.imported_at
    ${FROM} WHERE ev.application_number = $1`, [app]);
  if (!rows.length) return null;
  const r = rows[0];
  const [{ rows: crit }, { rows: elig }, { rows: [{ n: peers }] }] = await Promise.all([
    pool.query('SELECT code, criterion, label, weight, rating FROM cluster_eval_criteria WHERE application_number = $1 ORDER BY code', [app]),
    pool.query('SELECT test, label, hint, decision FROM cluster_eval_eligibility WHERE application_number = $1 ORDER BY LENGTH(test), test', [app]),
    pool.query('SELECT COUNT(*)::int AS n FROM cluster_evaluation WHERE eligibility = \'PASS\''),
  ]);
  const tests = Object.fromEntries(elig.map((t) => [t.test, t.decision]));
  const base = shapeRow(r, tests);
  const fin = screenRow(r);
  return {
    ...base,
    criteria: CRITERIA.map((c, i) => ({
      code: c.code, label: c.label, weight: c.weight,
      rating: n(r[`c${i + 1}_rating`]), score: n(r[`c${i + 1}_score`]), justification: r[`c${i + 1}_evidence`],
      indicators: crit.filter((x) => x.criterion === c.code).map((x) => ({ code: x.code, label: x.label, weight: n(x.weight), rating: n(x.rating), note: splitCriterionNotes(r[`c${i + 1}_evidence`])[x.code] ?? null })),
    })),
    eligibility_tests: elig.map((t) => ({ ...t, note: splitEligibilityNotes(r.eligibility_reasons)[t.test] ?? null })),
    eligibility_reasons: r.eligibility_reasons,
    evidence_files: r.evidence_ids,
    expert_remarks: r.expert_remarks,
    evaluator_finance: { result: r.workbook_financial_result, category: r.fs_category, document_check: r.fs_doc_check, issues: r.fs_issues, note: r.fs_note },
    financial_detail: fin,
    eligible_clusters: peers,
    source: { file: r.source_file, imported_at: r.imported_at },
  };
}
