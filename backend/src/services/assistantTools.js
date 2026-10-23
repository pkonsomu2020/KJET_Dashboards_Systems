/**
 * assistantTools.js
 *
 * The ONLY ways the AI assistant can touch data. Every function is read-only,
 * parameterised, and uses a fixed query shape. The model chooses which tool to
 * call and with what arguments; it never writes SQL and never does arithmetic.
 * Totals, counts and percentages are all computed here, in Postgres.
 */
import pool from '../db/pool.js';
import { getClusterByNumber } from './clusterService.js';

const MAX_ROWS = 50;

// Whitelisted metrics: tool argument -> SQL expression. Nothing else can be sorted or summed.
const METRICS = {
  total_project_cost:   'f.total_project_cost',
  section5_budget_total: 'f.section5_budget_total',
  grant_requested:      'f.grant_requested',
  cluster_contribution: 'f.cluster_contribution',
  total_members:        'm.total_members',
  men:                  'm.men',
  women:                'm.women',
  youth:                'm.youth',
  pwd:                  'm.pwd',
  jobs_today:           'e.jobs_today',
  jobs_year1:           'e.jobs_year1',
  jobs_year3:           'e.jobs_year3',
  women_pct:            '(100.0 * m.women / NULLIF(m.total_members, 0))',
  youth_pct:            '(100.0 * m.youth / NULLIF(m.total_members, 0))',
  grant_share_pct:      'f.grant_share_pct',
  cluster_share_pct:    'f.cluster_share_pct',
};

const GROUPS = {
  county:            'c.county',
  value_chain:       'c.value_chain',
  compliance_status: 'f.compliance_status',
  legal_form:        'c.legal_form',
};

const FROM = `
  FROM clusters c
  LEFT JOIN cluster_financials f ON f.cluster_id = c.id
  LEFT JOIN cluster_membership m ON m.cluster_id = c.id
  LEFT JOIN cluster_employment e ON e.cluster_id = c.id`;

const LIST_COLUMNS = `
  c.application_number, c.cluster_name, c.county, c.constituency, c.ward,
  c.value_chain, c.legal_form,
  f.total_project_cost, f.grant_requested, f.cluster_contribution,
  f.section5_budget_total, f.compliance_status,
  m.total_members, m.men, m.women, m.youth, m.pwd,
  e.jobs_today, e.jobs_year1, e.jobs_year3`;

/** Builds a WHERE clause from the shared filter arguments. */
function buildFilters(args = {}) {
  const where = [];
  const params = [];
  const add = (sql, value) => { params.push(value); where.push(sql.replace('?', `$${params.length}`)); };

  if (args.text) {
    params.push(`%${args.text}%`);
    const i = `$${params.length}`;
    where.push(`(c.cluster_name ILIKE ${i} OR c.application_number ILIKE ${i} OR c.county ILIKE ${i}
      OR c.constituency ILIKE ${i} OR c.ward ILIKE ${i} OR c.value_chain ILIKE ${i})`);
  }
  if (args.county)            add('c.county ILIKE ?', args.county);
  if (args.value_chain)       add('c.value_chain ILIKE ?', `%${args.value_chain}%`);
  if (args.compliance_status) add('f.compliance_status = ?', args.compliance_status);
  if (args.min_members != null) add('m.total_members >= ?', Number(args.min_members));
  if (args.min_women_pct != null)
    add('(100.0 * m.women / NULLIF(m.total_members, 0)) >= ?', Number(args.min_women_pct));
  if (args.min_project_cost != null) add('f.total_project_cost >= ?', Number(args.min_project_cost));
  if (args.max_project_cost != null) add('f.total_project_cost <= ?', Number(args.max_project_cost));
  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

const filterProps = {
  text:              { type: 'string', description: 'Free text matched against cluster name, application number, county, constituency, ward or value chain.' },
  county:            { type: 'string', description: 'County name, e.g. "Nakuru".' },
  value_chain:       { type: 'string', description: 'Value chain or part of it, e.g. "Dairy".' },
  compliance_status: { type: 'string', enum: ['Within limits', 'Review required', 'Missing financials'] },
  min_members:       { type: 'number' },
  min_women_pct:     { type: 'number', description: 'Minimum women share of members, 0-100.' },
  min_project_cost:  { type: 'number', description: 'KES.' },
  max_project_cost:  { type: 'number', description: 'KES.' },
};

// ── Tool implementations ──────────────────────────────────────

async function searchClusters(args) {
  const { clause, params } = buildFilters(args);
  const limit = Math.min(MAX_ROWS, Math.max(1, Number(args.limit) || 20));
  const [{ rows }, { rows: [count] }] = await Promise.all([
    pool.query(`SELECT ${LIST_COLUMNS} ${FROM} ${clause} ORDER BY c.cluster_name ASC LIMIT ${limit}`, params),
    pool.query(`SELECT COUNT(*)::int AS total ${FROM} ${clause}`, params),
  ]);
  const result = { total_matching: count.total, returned: rows.length, clusters: rows };
  if (count.total === 0 && args.text) {
    result.no_exact_match = true;
    result.did_you_mean = await suggestClusters(args.text);
  }
  return result;
}

async function getCluster({ application_number }) {
  const { data } = await getClusterByNumber(String(application_number ?? '').trim());
  if (!data) return { found: false, application_number };
  return { found: true, cluster: data };
}

async function rankClusters(args) {
  const metric = METRICS[args.metric];
  if (!metric) return { error: `metric must be one of: ${Object.keys(METRICS).join(', ')}` };
  const dir = args.order === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.min(MAX_ROWS, Math.max(1, Number(args.limit) || 10));
  const { clause, params } = buildFilters(args);
  const { rows } = await pool.query(
    `SELECT ${LIST_COLUMNS}, ${metric} AS metric_value ${FROM} ${clause}
     ORDER BY ${metric} ${dir} NULLS LAST, c.cluster_name ASC LIMIT ${limit}`, params);
  return { metric: args.metric, order: dir.toLowerCase(), clusters: rows };
}

async function portfolioStats(args) {
  const { clause, params } = buildFilters(args);
  const totals = `
    COUNT(c.id)::int AS clusters,
    COUNT(DISTINCT c.county)::int AS counties,
    COALESCE(SUM(f.total_project_cost),0) AS total_project_cost,
    COALESCE(SUM(f.section5_budget_total),0) AS section5_budget_total,
    COALESCE(SUM(f.grant_requested),0) AS grant_requested,
    COALESCE(SUM(f.cluster_contribution),0) AS cluster_contribution,
    COALESCE(SUM(m.total_members),0)::int AS total_members,
    COALESCE(SUM(m.men),0)::int AS men,
    COALESCE(SUM(m.women),0)::int AS women,
    COALESCE(SUM(m.youth),0)::int AS youth,
    COALESCE(SUM(m.pwd),0)::int AS pwd,
    COALESCE(SUM(e.jobs_today),0)::int AS jobs_today,
    COALESCE(SUM(e.jobs_year1),0)::int AS jobs_year1,
    COALESCE(SUM(e.jobs_year3),0)::int AS jobs_year3`;
  if (args.group_by && GROUPS[args.group_by]) {
    const g = GROUPS[args.group_by];
    const { rows } = await pool.query(
      `SELECT ${g} AS group_name, ${totals} ${FROM} ${clause} GROUP BY ${g} ORDER BY clusters DESC, group_name`, params);
    return { group_by: args.group_by, groups: rows };
  }
  const { rows } = await pool.query(`SELECT ${totals} ${FROM} ${clause}`, params);
  return { totals: rows[0] };
}

// ── Fuzzy name matching (used when an exact search finds nothing) ──

const STOPWORDS = new Set(['the','of','and','co','operative','cooperative','society','ltd','limited','sacco','group','self','help','cbo']);
const norm = (t) => String(t ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const tokens = (t) => norm(t).split(' ').filter((w) => w && !STOPWORDS.has(w));

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}
const wordSim = (a, b) => 1 - levenshtein(a, b) / Math.max(a.length, b.length, 1);

function trigrams(t) {
  const x = `  ${norm(t)} `;
  const out = new Set();
  for (let i = 0; i < x.length - 2; i++) out.add(x.slice(i, i + 3));
  return out;
}
function trigramSim(a, b) {
  const A = trigrams(a), B = trigrams(b);
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / Math.max(A.size + B.size - inter, 1);
}

function nameScore(query, candidate) {
  const qt = tokens(query);
  const ct = tokens(candidate);
  let tokenScore = 0;
  if (qt.length && ct.length) {
    tokenScore = qt.reduce((sum, w) => sum + Math.max(...ct.map((c) => (c.includes(w) || w.includes(c)) && Math.min(c.length, w.length) >= 4 ? 0.95 : wordSim(w, c))), 0) / qt.length;
  }
  return Math.max(tokenScore, trigramSim(query, candidate));
}

/** Closest cluster names to a (possibly misspelled) query. Scores are 0-1 similarity. */
export async function suggestClusters(query, limit = 5) {
  const { rows } = await pool.query(
    'SELECT application_number, cluster_name, county, ward, value_chain FROM clusters');
  const scored = rows
    .map((r) => ({
      ...r,
      similarity: Number(Math.max(nameScore(query, r.cluster_name), nameScore(query, `${r.cluster_name} ${r.county}`) * 0.95).toFixed(2)),
    }))
    .filter((r) => r.similarity >= 0.4)
    .sort((a, b) => b.similarity - a.similarity);
  // Keep only matches close to the best one, so generic shared words ("dairy") don't pad the list.
  const floor = scored.length ? Math.max(0.4, scored[0].similarity - 0.25) : 1;
  return scored.filter((r) => r.similarity >= floor).slice(0, limit);
}

async function suggestClustersTool({ name }) {
  const suggestions = await suggestClusters(String(name ?? ''));
  return { note: 'These are approximate matches, NOT confirmed. Present them as "did you mean" options.', suggestions };
}

// ── Registry exposed to the model ─────────────────────────────

// ── Document tools (full text of every file in the Drive section folders) ──

const DOC_COLS = `d.id AS document_id, c.application_number, c.cluster_name, d.section, d.original_filename,
  d.document_type, d.content_status, d.content_chars, d.modified_time, d.google_drive_url`;

function snippets(text, terms, max = 3, radius = 180) {
  const out = [];
  const lower = text.toLowerCase();
  let from = 0;
  while (out.length < max) {
    const idxs = terms.map((t) => lower.indexOf(t.toLowerCase(), from)).filter((i) => i >= 0);
    if (!idxs.length) break;
    const i = Math.min(...idxs);
    const start = Math.max(0, i - radius);
    const end = Math.min(text.length, i + radius);
    out.push(`${start > 0 ? '...' : ''}${text.slice(start, end).replace(/\s+/g, ' ')}${end < text.length ? '...' : ''}`);
    from = end;
  }
  return out;
}

async function listDocuments({ application_number }) {
  const { rows } = await pool.query(
    `SELECT ${DOC_COLS} FROM cluster_documents d JOIN clusters c ON c.id = d.cluster_id
      WHERE c.application_number = $1 ORDER BY d.section, d.original_filename`, [String(application_number ?? '').trim()]);
  return { application_number, total_files: rows.length, documents: rows };
}

async function searchDocuments({ query, application_number, limit }) {
  const terms = String(query ?? '').split(/\s+/).map((t) => t.trim()).filter((t) => t.length >= 2).slice(0, 6);
  if (!terms.length) return { error: 'query must contain at least one word of 2+ characters' };
  const params = [terms.map((t) => `%${t.replace(/[%_\\]/g, (m) => '\\' + m)}%`)];
  let where = 'd.content_text ILIKE ALL($1::text[])';
  if (application_number) { params.push(String(application_number).trim()); where += ` AND c.application_number = $${params.length}`; }
  const lim = Math.min(15, Math.max(1, Number(limit) || 8));
  // Most relevant first: total occurrences of the search words in the file (computed by the database)
  const score = terms
    .map((_, i) => `(length(d.content_text) - length(replace(lower(d.content_text), lower($${params.length + 1 + i}), ''))) / GREATEST(length($${params.length + 1 + i}), 1)`)
    .join(' + ');
  const [{ rows }, { rows: [count] }] = await Promise.all([
    pool.query(`SELECT ${DOC_COLS}, d.content_text, (${score}) AS match_count FROM cluster_documents d JOIN clusters c ON c.id = d.cluster_id
                 WHERE ${where} ORDER BY match_count DESC, c.application_number, d.original_filename LIMIT ${lim}`, [...params, ...terms]),
    pool.query(`SELECT COUNT(*)::int AS total FROM cluster_documents d JOIN clusters c ON c.id = d.cluster_id WHERE ${where}`, params),
  ]);
  return {
    searched_for: terms,
    total_matching_documents: count.total,
    returned: rows.length,
    documents: rows.map(({ content_text, ...meta }) => ({ ...meta, matches: snippets(content_text, terms) })),
  };
}

async function getDocument({ document_id, offset, length }) {
  const { rows } = await pool.query(
    `SELECT ${DOC_COLS}, d.content_text, d.content_error FROM cluster_documents d JOIN clusters c ON c.id = d.cluster_id WHERE d.id = $1`,
    [Number(document_id)]);
  if (!rows.length) return { found: false, document_id };
  const { content_text, ...meta } = rows[0];
  if (content_text == null) return { found: true, ...meta, text: null, note: `No text stored for this file (status: ${meta.content_status}).` };
  const start = Math.max(0, Number(offset) || 0);
  const len = Math.min(20000, Math.max(500, Number(length) || 12000));
  return {
    found: true, ...meta, total_chars: content_text.length, offset: start,
    text: content_text.slice(start, start + len), has_more: start + len < content_text.length,
  };
}

// ── Evaluation tools (scores and grant-ready list from the evaluation workbook) ──

const EVAL_NOTE = 'Source: the evaluation workbook, not the application. Recommended clusters remain subject to due diligence, environmental and social clearance, and World Bank no-objection. Do not call a cluster approved or funded unless msea_decision or approved_grant below says so.';

const EVAL_LIST = `
  ev.application_number, c.cluster_name, c.county, c.value_chain, ev.total_score, ev.band, ev.rank,
  ev.shortlisted, ev.shortlist_rank, ev.eligibility, ev.financial_screening, ev.data_readiness, ev.due_diligence,
  ev.es_disposition, ev.system_recommendation, ev.technical_rec, ev.max_eligible_grant`;

async function getEvaluation({ application_number }) {
  const { rows } = await pool.query(
    `SELECT ev.*, c.cluster_name, c.county, c.value_chain, f.total_project_cost AS drive_total_project_cost, f.grant_requested AS drive_grant_requested
       FROM cluster_evaluation ev JOIN clusters c ON c.application_number = ev.application_number
       LEFT JOIN cluster_financials f ON f.cluster_id = c.id WHERE ev.application_number = $1`,
    [String(application_number ?? '').trim()]);
  if (!rows.length) return { found: false, application_number, note: 'This cluster has no evaluation results in the database.' };
  return { found: true, note: EVAL_NOTE, evaluation: rows[0] };
}

async function listShortlist() {
  const { rows } = await pool.query(`SELECT ${EVAL_LIST} FROM cluster_evaluation ev JOIN clusters c ON c.application_number = ev.application_number WHERE ev.shortlisted ORDER BY ev.shortlist_rank`);
  return {
    note: EVAL_NOTE,
    rule: 'The grant-ready list is the clusters scoring 70 or more out of 100 whose eligibility check is PASS.',
    total_grant_ready: rows.length,
    clusters: rows,
  };
}

async function rankByScore(args) {
  const limit = Math.min(MAX_ROWS, Math.max(1, Number(args.limit) || 10));
  const where = [];
  const params = [];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (args.band) add('ev.band ILIKE ?', args.band);
  if (args.eligibility) add('ev.eligibility = ?', String(args.eligibility).toUpperCase());
  if (args.county) add('c.county ILIKE ?', args.county);
  if (args.value_chain) add('c.value_chain ILIKE ?', `%${args.value_chain}%`);
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [{ rows }, { rows: [count] }] = await Promise.all([
    pool.query(`SELECT ${EVAL_LIST} FROM cluster_evaluation ev JOIN clusters c ON c.application_number = ev.application_number ${clause} ORDER BY ev.total_score DESC NULLS LAST, c.cluster_name LIMIT ${limit}`, params),
    pool.query(`SELECT COUNT(*)::int AS total FROM cluster_evaluation ev JOIN clusters c ON c.application_number = ev.application_number ${clause}`, params),
  ]);
  return { note: EVAL_NOTE, total_matching: count.total, clusters: rows };
}

export const toolImpl = {
  get_evaluation: getEvaluation,
  list_shortlist: listShortlist,
  rank_by_score: rankByScore,
  list_documents: listDocuments,
  search_documents: searchDocuments,
  get_document: getDocument,
  search_clusters: searchClusters,
  get_cluster: getCluster,
  rank_clusters: rankClusters,
  portfolio_stats: portfolioStats,
  suggest_clusters: suggestClustersTool,
};

export const toolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'list_shortlist',
      description: 'The grant-ready list from the evaluation: clusters scoring 70+ with eligibility PASS, ranked, with gates and recommendations. Use for any question about which clusters are qualified, recommended or grant-ready.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_evaluation',
      description: 'The full evaluation of ONE cluster: total score, band, ranks, the six criterion scores and written justifications, every screening gate, recommendations, conditions, and the evaluation figures next to the Drive figures.',
      parameters: { type: 'object', properties: { application_number: { type: 'string' } }, required: ['application_number'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rank_by_score',
      description: 'Rank clusters by evaluation score (all 85, not only the grant-ready list), optionally filtered by band, eligibility (PASS, HOLD, FAIL), county or value chain.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer' },
          band: { type: 'string', enum: ['Recommended', 'Referred with Comments', 'Rejected'] },
          eligibility: { type: 'string', enum: ['PASS', 'HOLD', 'FAIL'] },
          county: { type: 'string' },
          value_chain: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_documents',
      description: 'List every file stored for a cluster (section folder, file name, type, and whether its text was readable). Use this to see what documents exist.',
      parameters: { type: 'object', properties: { application_number: { type: 'string' } }, required: ['application_number'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_documents',
      description: 'Search the full text of all stored files (PDF, Word, Excel, CSV, text) for words. Every word must appear in the document. Optionally limit to one cluster. Returns matching files with text snippets.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Words to find, e.g. "KRA PIN" or "Isuzu quotation".' },
          application_number: { type: 'string', description: 'Optional: only search this cluster.' },
          limit: { type: 'integer' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_document',
      description: 'Read the stored text of one file by document_id (from list_documents or search_documents). Long files are returned in chunks: use offset to continue when has_more is true.',
      parameters: {
        type: 'object',
        properties: { document_id: { type: 'integer' }, offset: { type: 'integer' }, length: { type: 'integer' } },
        required: ['document_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'suggest_clusters',
      description: 'Find the closest cluster names to a misspelled or partial name. Use when the user gives a name that search_clusters does not find. Results are approximate and must be offered as "did you mean" options.',
      parameters: { type: 'object', properties: { name: { type: 'string', description: 'The name as the user typed it.' } }, required: ['name'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_clusters',
      description: 'Find clusters matching filters. Returns the exact total number of matches plus up to 50 summary rows. Use get_cluster for full details of one cluster.',
      parameters: { type: 'object', properties: { ...filterProps, limit: { type: 'integer', description: 'Max rows, up to 50.' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_cluster',
      description: 'Return EVERY stored detail of one cluster (identity, contacts, banking, membership, business, products, buyers, machinery, services, quotations, financials, P&L, cashflow, balance sheet, employment, impact, risks, sustainability, documents).',
      parameters: { type: 'object', properties: { application_number: { type: 'string', description: 'e.g. KJET-2026-848853' } }, required: ['application_number'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rank_clusters',
      description: 'Top or bottom clusters by a metric, optionally filtered. The database does the sorting.',
      parameters: {
        type: 'object',
        properties: {
          ...filterProps,
          metric: { type: 'string', enum: Object.keys(METRICS) },
          order: { type: 'string', enum: ['asc', 'desc'] },
          limit: { type: 'integer' },
        },
        required: ['metric'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'portfolio_stats',
      description: 'Exact counts and sums (cost, grant, members, jobs...) for the whole portfolio or a filtered subset, optionally grouped. Always use this for totals, counts and percentages instead of adding numbers yourself.',
      parameters: { type: 'object', properties: { ...filterProps, group_by: { type: 'string', enum: Object.keys(GROUPS) } } },
    },
  },
];

/** Pulls application numbers out of a tool result so the UI can link sources. */
export function extractApplicationNumbers(result) {
  const out = new Set();
  if (result?.cluster?.application_number) out.add(result.cluster.application_number);
  if (result?.evaluation?.application_number) out.add(result.evaluation.application_number);
  if (result?.total_files > 0 && typeof result.application_number === 'string') out.add(result.application_number);
  for (const d of result?.documents ?? []) if (d.application_number) out.add(d.application_number);
  for (const c of result?.clusters ?? []) if (c.application_number) out.add(c.application_number);
  for (const c of result?.did_you_mean ?? []) if (c.application_number) out.add(c.application_number);
  for (const c of result?.suggestions ?? []) if (c.application_number) out.add(c.application_number);
  return [...out];
}
