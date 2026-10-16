import pool from '../db/pool.js';
import { cacheGet, cacheSet } from '../cache/redis.js';

const TTL = {
  list:    Number(process.env.CACHE_TTL_CLUSTER_LIST)   || 120,
  detail:  Number(process.env.CACHE_TTL_CLUSTER_DETAIL) || 600,
  summary: Number(process.env.CACHE_TTL_PORTFOLIO)      || 300,
};

// ── Portfolio summary (KPI cards) ────────────────────────────
export async function getPortfolioSummary() {
  const cacheKey = 'portfolio:summary';
  const cached = await cacheGet(cacheKey);
  if (cached) return { ...cached, cached: true };

  const { rows } = await pool.query(`
    SELECT
      COUNT(c.id)                            AS count,
      COUNT(DISTINCT c.county)               AS counties,
      COUNT(DISTINCT c.value_chain)          AS value_chains,
      COALESCE(SUM(f.total_project_cost),0)  AS cost,
      COALESCE(SUM(f.grant_requested),0)     AS grant,
      COALESCE(SUM(f.cluster_contribution),0) AS contribution,
      COALESCE(SUM(f.section5_budget_total),0) AS budget,
      COALESCE(SUM(m.total_members),0)       AS members,
      COALESCE(SUM(m.women),0)               AS women,
      COALESCE(SUM(m.men),0)                 AS men,
      COALESCE(SUM(m.youth),0)               AS youth,
      COALESCE(SUM(m.pwd),0)                 AS pwd,
      COALESCE(SUM(e.jobs_today),0)          AS jobs_today,
      COALESCE(SUM(e.jobs_year1),0)          AS jobs_year1,
      COALESCE(SUM(e.jobs_year3),0)          AS jobs_year3,
      COUNT(CASE WHEN f.compliance_status='Within limits'      THEN 1 END) AS within_limits,
      COUNT(CASE WHEN f.compliance_status='Review required'    THEN 1 END) AS reviews,
      COUNT(CASE WHEN f.compliance_status='Missing financials' THEN 1 END) AS missing
    FROM clusters c
    LEFT JOIN cluster_financials f  ON f.cluster_id = c.id
    LEFT JOIN cluster_membership m  ON m.cluster_id = c.id
    LEFT JOIN cluster_employment e  ON e.cluster_id = c.id
  `);

  const result = rows[0];
  await cacheSet(cacheKey, result, TTL.summary);
  return result;
}

// ── Grouped by value chain ────────────────────────────────────
export async function getByValueChain() {
  const cacheKey = 'portfolio:by-chain';
  const cached = await cacheGet(cacheKey);
  if (cached) return { data: cached, cached: true };

  const { rows } = await pool.query(`
    SELECT
      c.value_chain                          AS name,
      COUNT(c.id)                            AS count,
      COALESCE(SUM(f.total_project_cost),0)  AS cost,
      COALESCE(SUM(f.grant_requested),0)     AS grant
    FROM clusters c
    LEFT JOIN cluster_financials f ON f.cluster_id = c.id
    GROUP BY c.value_chain
    ORDER BY cost DESC
  `);

  await cacheSet(cacheKey, rows, TTL.summary);
  return { data: rows, cached: false };
}

// ── Grouped by county ─────────────────────────────────────────
export async function getByCounty() {
  const cacheKey = 'portfolio:by-county';
  const cached = await cacheGet(cacheKey);
  if (cached) return { data: cached, cached: true };

  const { rows } = await pool.query(`
    SELECT
      c.county                               AS name,
      COUNT(c.id)                            AS count,
      COALESCE(SUM(f.total_project_cost),0)  AS cost,
      COALESCE(SUM(f.grant_requested),0)     AS grant
    FROM clusters c
    LEFT JOIN cluster_financials f ON f.cluster_id = c.id
    GROUP BY c.county
    ORDER BY cost DESC
  `);

  await cacheSet(cacheKey, rows, TTL.summary);
  return { data: rows, cached: false };
}

// ── Cluster list (with filters) ───────────────────────────────
export async function getClusters({ county, chain, sort, q, review, page, limit }) {
  const pageNum  = Math.max(1, parseInt(page)  || 1);
  const pageSize = Math.min(100, parseInt(limit) || 20);
  const offset   = (pageNum - 1) * pageSize;

  const cacheKey = `clusters:list:${county}:${chain}:${sort}:${q}:${review}:${pageNum}:${pageSize}`;
  const cached   = await cacheGet(cacheKey);
  if (cached) return { ...cached, cached: true };

  const params = [];
  const conditions = [];
  let idx = 1;

  if (county) { conditions.push(`c.county = $${idx++}`); params.push(county); }
  if (chain)  { conditions.push(`c.value_chain = $${idx++}`); params.push(chain); }
  if (review) { conditions.push(`f.compliance_status != 'Within limits'`); }
  if (q) {
    conditions.push(`(
      c.cluster_name ILIKE $${idx} OR
      c.application_number ILIKE $${idx} OR
      c.county ILIKE $${idx} OR
      c.value_chain ILIKE $${idx}
    )`);
    params.push(`%${q}%`);
    idx++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const order = sort === 'cost'    ? 'f.total_project_cost DESC'
              : sort === 'grant'   ? 'f.grant_requested DESC'
              : sort === 'members' ? 'm.total_members DESC'
              :                     'c.cluster_name ASC';

  const dataQ = `
    SELECT
      c.id, c.application_number, c.cluster_name,
      c.county, c.constituency, c.ward, c.value_chain, c.legal_form,
      c.registration_date, c.google_drive_folder,
      f.total_project_cost, f.section5_budget_total,
      f.grant_requested, f.cluster_contribution,
      f.cluster_share_pct, f.grant_share_pct,
      f.machinery_source, f.lead_time,
      f.compliance_status,
      m.total_members, m.men, m.women, m.youth, m.pwd,
      e.jobs_today, e.jobs_year1, e.jobs_year3
    FROM clusters c
    LEFT JOIN cluster_financials f  ON f.cluster_id = c.id
    LEFT JOIN cluster_membership m  ON m.cluster_id = c.id
    LEFT JOIN cluster_employment e  ON e.cluster_id = c.id
    ${where}
    ORDER BY ${order}
    LIMIT $${idx} OFFSET $${idx + 1}
  `;

  const countQ = `
    SELECT COUNT(*) FROM clusters c
    LEFT JOIN cluster_financials f ON f.cluster_id = c.id
    ${where}
  `;

  const [dataRes, countRes] = await Promise.all([
    pool.query(dataQ, [...params, pageSize, offset]),
    pool.query(countQ, params),
  ]);

  const result = {
    data:       dataRes.rows,
    total:      Number(countRes.rows[0].count),
    page:       pageNum,
    pageSize,
    pageCount:  Math.ceil(Number(countRes.rows[0].count) / pageSize),
  };

  await cacheSet(cacheKey, result, TTL.list);
  return { ...result, cached: false };
}

// ── Single cluster (full profile, all tables) ─────────────────
export async function getClusterByNumber(applicationNumber) {
  const cacheKey = `cluster:detail:${applicationNumber}`;
  const cached   = await cacheGet(cacheKey);
  if (cached) return { data: cached, cached: true };

  // Core
  const { rows: base } = await pool.query(`
    SELECT c.*, f.*, m.*, e.*,
      row_to_json(bk) AS banking
    FROM clusters c
    LEFT JOIN cluster_financials  f  ON f.cluster_id = c.id
    LEFT JOIN cluster_membership  m  ON m.cluster_id = c.id
    LEFT JOIN cluster_employment  e  ON e.cluster_id = c.id
    LEFT JOIN LATERAL (
      SELECT * FROM cluster_banking WHERE cluster_id = c.id LIMIT 1
    ) bk ON TRUE
    WHERE c.application_number = $1
  `, [applicationNumber]);

  if (!base.length) return { data: null, cached: false };

  const clusterId = base[0].id;

  // Parallel fetch of all sub-tables
  const [contacts, business, products, buyers, machinery, services,
         quotations, pl, cashflow, balancesheet, impact,
         risks, sustainability, documents] = await Promise.all([
    pool.query('SELECT * FROM cluster_contacts    WHERE cluster_id=$1 ORDER BY contact_type', [clusterId]),
    pool.query('SELECT * FROM cluster_business    WHERE cluster_id=$1 LIMIT 1',              [clusterId]),
    pool.query('SELECT * FROM cluster_products    WHERE cluster_id=$1 ORDER BY product_order',[clusterId]),
    pool.query('SELECT * FROM cluster_buyers      WHERE cluster_id=$1 ORDER BY buyer_order', [clusterId]),
    pool.query('SELECT * FROM cluster_machinery   WHERE cluster_id=$1 ORDER BY item_order',  [clusterId]),
    pool.query('SELECT * FROM cluster_services    WHERE cluster_id=$1 ORDER BY item_order',  [clusterId]),
    pool.query('SELECT * FROM cluster_quotations  WHERE cluster_id=$1 ORDER BY item_order',  [clusterId]),
    pool.query('SELECT * FROM cluster_pl          WHERE cluster_id=$1 ORDER BY year',         [clusterId]),
    pool.query('SELECT * FROM cluster_cashflow    WHERE cluster_id=$1 ORDER BY year, month',  [clusterId]),
    pool.query('SELECT * FROM cluster_balancesheet WHERE cluster_id=$1 ORDER BY year',        [clusterId]),
    pool.query('SELECT * FROM cluster_impact      WHERE cluster_id=$1 LIMIT 1',              [clusterId]),
    pool.query('SELECT * FROM cluster_risks       WHERE cluster_id=$1 ORDER BY risk_category',[clusterId]),
    pool.query('SELECT * FROM cluster_sustainability WHERE cluster_id=$1 LIMIT 1',           [clusterId]),
    pool.query('SELECT * FROM cluster_documents   WHERE cluster_id=$1 ORDER BY section',     [clusterId]),
  ]);

  const data = {
    ...base[0],
    contacts:       contacts.rows,
    business:       business.rows[0] || null,
    products:       products.rows,
    buyers:         buyers.rows,
    machinery:      machinery.rows,
    services:       services.rows,
    quotations:     quotations.rows,
    pl:             pl.rows,
    cashflow:       cashflow.rows,
    balancesheet:   balancesheet.rows,
    impact:         impact.rows[0] || null,
    risks:          risks.rows,
    sustainability: sustainability.rows[0] || null,
    documents:      documents.rows,
  };

  await cacheSet(cacheKey, data, TTL.detail);
  return { data, cached: false };
}
