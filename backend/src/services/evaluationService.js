import pool from '../db/pool.js';
import { cacheGet, cacheSet } from '../cache/redis.js';

const TTL = Number(process.env.CACHE_TTL_PORTFOLIO) || 300;

const COLUMNS = `
  ev.application_number, ev.shortlisted, ev.shortlist_rank, ev.shortlist_reason,
  ev.total_score, ev.band, ev.rank, ev.county_rank, ev.category,
  ev.c1_rating, ev.c1_score, ev.c2_rating, ev.c2_score, ev.c3_rating, ev.c3_score,
  ev.c4_rating, ev.c4_score, ev.c5_rating, ev.c5_score, ev.c6_rating, ev.c6_score,
  ev.financial_screening, ev.data_readiness, ev.eligibility, ev.due_diligence, ev.exclusion_status, ev.es_disposition,
  ev.system_recommendation, ev.technical_rec, ev.msea_decision, ev.approved_grant, ev.wb_status, ev.conditions,
  c.cluster_name, c.county, c.constituency, c.value_chain, c.legal_form,
  f.total_project_cost, f.grant_requested, f.cluster_contribution,
  m.total_members, m.women, m.youth, m.pwd,
  e.jobs_today, e.jobs_year3`;

const FROM = `
  FROM cluster_evaluation ev
  JOIN clusters c ON c.application_number = ev.application_number
  LEFT JOIN cluster_financials f ON f.cluster_id = c.id
  LEFT JOIN cluster_membership m ON m.cluster_id = c.id
  LEFT JOIN cluster_employment e ON e.cluster_id = c.id`;

/** The grant-ready shortlist. Scores and decisions come from the evaluation; every amount comes from the application data synced from Drive. */
export async function getShortlist() {
  const cacheKey = 'evaluation:shortlist';
  const cached = await cacheGet(cacheKey);
  if (cached) return { ...cached, cached: true };

  const [{ rows }, { rows: bands }, { rows: [meta] }] = await Promise.all([
    pool.query(`SELECT ${COLUMNS} ${FROM} WHERE ev.shortlisted ORDER BY ev.shortlist_rank, ev.total_score DESC`),
    pool.query('SELECT band, COUNT(*)::int AS n FROM cluster_evaluation GROUP BY band ORDER BY MIN(-total_score)'),
    pool.query('SELECT MAX(source_file) AS source_file, MAX(imported_at) AS imported_at, COUNT(*)::int AS evaluated FROM cluster_evaluation'),
  ]);
  const data = rows;
  const sum = (k) => data.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  const result = {
    data,
    summary: {
      clusters: data.length,
      average_score: data.length ? Math.round((sum('total_score') / data.length) * 10) / 10 : 0,
      counties: new Set(data.map((r) => r.county)).size,
      value_chains: new Set(data.map((r) => r.value_chain)).size,
      members: sum('total_members'),
      women: sum('women'),
      requested_per_drive: sum('grant_requested'),
      project_cost: sum('total_project_cost'),
      projected_jobs_year3: sum('jobs_year3'),
    },
    bands,
    meta,
  };
  await cacheSet(cacheKey, result, TTL);
  return { ...result, cached: false };
}
