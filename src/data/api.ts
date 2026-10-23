// ── Base URL ──────────────────────────────────────────────────
// Vite exposes VITE_* env vars at build time.
// Falls back to localhost:4000 for local dev.
const BASE = (import.meta.env['VITE_API_URL'] as string | undefined) ?? 'http://localhost:4000';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',   // send auth cookies
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `API error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── Response types ────────────────────────────────────────────

export interface PortfolioSummary {
  count: string;
  counties: string;
  value_chains: string;
  cost: string;
  grant: string;
  contribution: string;
  budget: string;
  members: string;
  women: string;
  men: string;
  youth: string;
  pwd: string;
  jobs_today: string;
  jobs_year1: string;
  jobs_year3: string;
  within_limits: string;
  reviews: string;
  missing: string;
  cached?: boolean;
}

export interface ChainGroup {
  name: string;
  count: string;
  cost: string;
  grant: string;
}

export interface CountyGroup {
  name: string;
  count: string;
  cost: string;
  grant: string;
}

export interface ComplianceRow {
  compliance_status: string;
  count: string;
}

export interface ClusterRow {
  id: number;
  application_number: string;
  cluster_name: string;
  county: string;
  constituency: string;
  ward: string;
  value_chain: string;
  legal_form: string;
  registration_date: string;
  google_drive_folder: string;
  total_project_cost: string;
  section5_budget_total: string;
  grant_requested: string;
  cluster_contribution: string;
  cluster_share_pct: string;
  grant_share_pct: string;
  machinery_source: string;
  lead_time: string;
  compliance_status: string;
  total_members: string;
  men: string;
  women: string;
  youth: string;
  pwd: string;
  jobs_today: string;
  jobs_year1: string;
  jobs_year3: string;
  // evaluation (null until the evaluation workbook has been imported)
  total_score: string | null;
  eval_band: string | null;
  eval_rank: number | null;
  shortlisted: boolean | null;
  shortlist_rank: number | null;
}

export interface ClusterListResponse {
  ok: boolean;
  data: ClusterRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  cached: boolean;
}

export interface ClusterDetail extends ClusterRow {
  evaluation: EvaluationRow | null;
  status: string;
  physical_address: string;
  phone: string;
  email: string;
  vision: string;
  mission: string;
  goal_1: string;
  goal_2: string;
  goal_3: string;
  goal_4: string;
  goal_5: string;
  signatories: string;
  executives_ownership: string;
  prior_funding: string;
  banking: { bank_name: string; bank_account: string } | null;
  contacts: Array<{
    contact_type: string;
    full_name: string;
    position: string;
    phone: string;
    email: string;
    id_number: string;
  }>;
  business: {
    business_description: string;
    investment_needs: string;
    market_geography: string;
    market_size: string;
    competitor_1: string;
    competitor_2: string;
    competitor_3: string;
    pricing_method: string;
    production_process: string;
    installed_capacity: string;
    installed_capacity_unit: string;
    current_output: string;
    current_output_unit: string;
    capacity_utilisation_pct: string;
    main_bottleneck: string;
  } | null;
  machinery: Array<{ item_order: number; description: string; quantity: string; unit_cost_kes: string; total_cost_kes: string }>;
  services: Array<{ item_order: number; description: string; total_cost_kes?: string }>;
  products: Array<{ product_name: string; unit: string; price_kes: string; active_months: string }>;
  buyers: Array<{ buyer_name: string; buyer_type: string; annual_volume: string; annual_revenue: string; contract_years: string }>;
  risks: Array<{ risk_category: string; likelihood: string; impact: string; mitigation: string }>;
  sustainability: { sustainability_plan: string } | null;
  documents: Array<{ section: string; document_type: string; original_filename: string; google_drive_url: string }>;
  pl: Array<{ year: number; revenue_with: string; net_profit_with: string; ebitda_with: string }>;
  impact: {
    daily_output_today: string; daily_output_after: string; daily_output_pct: string;
    reject_rate_today: string; reject_rate_after: string;
    sales_uplift_y1_revenue: string; sales_uplift_y2_revenue: string; sales_uplift_y3_revenue: string;
    jobs_women_today: string; jobs_women_year1: string; jobs_women_year3: string;
    jobs_youth_today: string; jobs_youth_year1: string; jobs_youth_year3: string;
    jobs_pwd_today: string; jobs_pwd_year1: string; jobs_pwd_year3: string;
    income_today: string; income_year1: string; income_year3: string;
  } | null;
  // Financials extended
  npv_kes?: string;
  irr_pct?: string;
  payback_period_years?: string;
  // Fallback narrative fields (from clusters table)
  business_description?: string;
  investment_needs?: string;
  // Governance fallbacks (from contacts join)
  governance_rep_name?: string;
  governance_rep_position?: string;
}

export interface MetaResponse {
  ok: boolean;
  counties: string[];
  chains: string[];
}

// ── API functions ─────────────────────────────────────────────

export function fetchPortfolioSummary() {
  return get<{ ok: boolean; data: PortfolioSummary }>('/api/portfolio/summary');
}

export function fetchByChain() {
  return get<{ ok: boolean; data: ChainGroup[] }>('/api/portfolio/by-chain');
}

export function fetchByCounty() {
  return get<{ ok: boolean; data: CountyGroup[] }>('/api/portfolio/by-county');
}

export function fetchCompliance() {
  return get<{ ok: boolean; data: ComplianceRow[] }>('/api/portfolio/compliance');
}

export interface ClusterListParams {
  county?: string;
  chain?: string;
  sort?: string;
  q?: string;
  review?: boolean;
  shortlist?: boolean;
  page?: number;
  limit?: number;
}

export function fetchClusters(params: ClusterListParams = {}) {
  const p = new URLSearchParams();
  if (params.county) p.set('county', params.county);
  if (params.chain)  p.set('chain',  params.chain);
  if (params.sort)   p.set('sort',   params.sort);
  if (params.q)      p.set('q',      params.q);
  if (params.review) p.set('review', 'true');
  if (params.shortlist) p.set('shortlist', 'true');
  if (params.page)   p.set('page',   String(params.page));
  if (params.limit)  p.set('limit',  String(params.limit));
  const qs = p.toString();
  return get<ClusterListResponse>(`/api/clusters${qs ? `?${qs}` : ''}`);
}

export function fetchMeta() {
  return get<MetaResponse>('/api/clusters/meta');
}

export function fetchClusterDetail(applicationNumber: string) {
  return get<{ ok: boolean; data: ClusterDetail }>(`/api/clusters/${applicationNumber}`);
}

// ── AI assistant ──────────────────────────────────────────────

export interface AssistantMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssistantResponse {
  ok: boolean;
  answer: string;
  sources: string[];
  trace: Array<{ tool: string; args: Record<string, unknown> }>;
}

export async function askAssistant(question: string, history: AssistantMessage[]): Promise<AssistantResponse> {
  const res = await fetch(`${BASE}/api/assistant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ question, history }),
  });
  const body = (await res.json().catch(() => ({}))) as AssistantResponse & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Assistant error ${res.status}`);
  return body;
}

// ── Evaluation (scores and grant-ready list from the evaluation workbook) ──

type Num = string | number | null;

export interface EvaluationFigureNote {
  field: string;
  evaluation: number;
  drive: number;
}

export interface EvaluationRow {
  application_number: string;
  shortlisted: boolean | null;
  shortlist_rank: number | null;
  shortlist_reason: string | null;
  total_score: Num;
  band: string | null;
  rank: number | null;
  county_rank: number | null;
  category: string | null;
  c1_rating: Num; c1_score: Num; c1_evidence?: string | null;
  c2_rating: Num; c2_score: Num; c2_evidence?: string | null;
  c3_rating: Num; c3_score: Num; c3_evidence?: string | null;
  c4_rating: Num; c4_score: Num; c4_evidence?: string | null;
  c5_rating: Num; c5_score: Num; c5_evidence?: string | null;
  c6_rating: Num; c6_score: Num; c6_evidence?: string | null;
  financial_screening: string | null;
  data_readiness: string | null;
  eligibility: string | null;
  due_diligence: string | null;
  exclusion_status: string | null;
  es_disposition: string | null;
  system_recommendation: string | null;
  technical_rec: string | null;
  msea_decision: string | null;
  approved_grant: Num;
  wb_status: string | null;
  conditions: string | null;
  eval_total_cost: Num;
  eval_grant_requested: Num;
  max_eligible_grant: Num;
  eval_value_chain: string | null;
  source_file?: string | null;
  imported_at?: string | null;
}

export interface ShortlistRow extends EvaluationRow {
  cluster_name: string;
  county: string;
  constituency: string;
  value_chain: string;
  legal_form: string;
  total_project_cost: Num;
  grant_requested: Num;
  cluster_contribution: Num;
  total_members: Num;
  women: Num;
  youth: Num;
  pwd: Num;
  jobs_today: Num;
  jobs_year3: Num;
  figure_notes: EvaluationFigureNote[];
}

export interface EvaluationResponse {
  ok: boolean;
  data: ShortlistRow[];
  summary: {
    clusters: number;
    average_score: number;
    counties: number;
    value_chains: number;
    members: number;
    women: number;
    requested_per_drive: number;
    eligible_grant: number;
    projected_jobs_year3: number;
  };
  bands: Array<{ band: string; n: number }>;
  meta: { source_file: string | null; imported_at: string | null; evaluated: number };
}

export function fetchEvaluation() {
  return get<EvaluationResponse>('/api/evaluation');
}
