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
  jobs_excluded_count: string;
  jobs_excluded: Array<{ application_number: string; name: string; county: string; jobs_today: number | null; jobs_year1: number | null; jobs_year3: number | null }>;
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
  contribution: string;
  /** the sectors behind a catch-all such as "Other", from the evaluation sheet */
  breakdown: Array<{ sector: string; count: number }>;
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
  status: string;
  // employment: total, women, youth and people with disability, today / year 1 / year 3
  jobs_women_today: string | null; jobs_women_year1: string | null; jobs_women_year3: string | null;
  jobs_youth_today: string | null; jobs_youth_year1: string | null; jobs_youth_year3: string | null;
  jobs_pwd_today: string | null; jobs_pwd_year1: string | null; jobs_pwd_year3: string | null;
  income_today: string | null; income_year1: string | null; income_year3: string | null; income_assumptions: string | null;
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

// ── Evaluation (scores and findings from the online evaluation sheet; amounts and the 50-50 checks from Drive) ──

export interface EvalFinancial {
  result: string;
  category: string;
  issues: string[];
  total: number | null;
  contribution: number | null;
  grant: number | null;
  contribution_plus_grant: number | null;
  total_minus_contribution_and_grant: number | null;
  arithmetic_consistent: boolean | null;
  implausible_amounts: boolean;
  cluster_share: number | null;
  kjet_share: number | null;
  meets_50_percent_cash: boolean | null;
  max_eligible_grant: number | null;
  grant_above_max: number | null;
  min_cluster_cash: number | null;
  contribution_shortfall: number | null;
}

export interface EvalRow {
  application_number: string;
  cluster_name: string;
  county: string;
  constituency: string | null;
  value_chain: string;
  legal_form: string | null;
  score: number | null;
  band: string | null;
  rank: number | null;
  county_rank: number | null;
  eligibility: string | null;
  criteria: Array<{ code: string; weight: number; rating: number | null; score: number | null }>;
  tests: Record<string, string | null>;
  financial: EvalFinancial;
  members: number | null;
  women: number | null;
  youth: number | null;
  pwd: number | null;
  jobs_today: number | null;
  jobs_year3: number | null;
}

export interface EvalSheetStatus {
  enabled: boolean;
  sheet_name: string | null;
  sheet_modified: string | null;
  last_checked: string | null;
  last_imported: string | null;
  last_error: string | null;
}

export interface EvalListResponse {
  ok: boolean;
  data: EvalRow[];
  meta: { source_file: string | null; imported_at: string | null; evaluated: number; sheet: EvalSheetStatus };
  criteria: Array<{ code: string; label: string; weight: number }>;
}

export interface EvalOverview {
  ok: boolean;
  funnel: Array<{ stage: string; count: number }>;
  bands: Array<{ band: string; count: number }>;
  eligibility: Array<{ status: string; count: number }>;
  financial_results: Array<{ result: string; count: number }>;
  categories: Array<{ category: string; count: number }>;
  cash_shortfall_clusters: number;
  score_distribution: Array<{ label: string; count: number }>;
  average_score: number | null;
  criteria_average: Array<{ code: string; label: string; weight: number; average: number | null }>;
  tests: Array<{ test: string; label: string; pass: number; hold: number; fail: number }>;
  counties: Array<{ name: string; count: number; average_score: number | null; eligible: number }>;
  value_chains: Array<{ name: string; count: number; average_score: number | null; eligible: number }>;
  top_issues: Array<{ issue: string; count: number }>;
  meta: EvalListResponse['meta'];
}

export interface EvalDetail extends EvalRow {
  criteria: Array<{
    code: string; label: string; weight: number; rating: number | null; score: number | null; justification: string | null;
    indicators: Array<{ code: string; label: string; weight: number; rating: number | null; note: string | null }>;
  }>;
  eligibility_tests: Array<{ test: string; label: string; hint: string | null; decision: string | null; note: string | null }>;
  eligibility_reasons: string | null;
  evidence_files: string | null;
  expert_remarks: string | null;
  assessment: { assessor: string | null; assessed_on: string | null; reviewer: string | null; reviewed_on: string | null; eligibility_assessor: string | null; eligibility_assessed_on: string | null };
  evaluator_finance: { result: string | null; category: string | null; document_check: string | null; issues: string | null; note: string | null };
  financial_detail: { result: string; category: string; issues: string[]; figures: { total: number | null; contribution: number | null; grant: number | null }; checks: Omit<EvalFinancial, 'result' | 'category' | 'issues' | 'total' | 'contribution' | 'grant'> };
  clusters_ranked: number;
  source: { file: string | null; imported_at: string | null };
}

export function fetchEvaluationList() {
  return get<EvalListResponse>('/api/evaluation/clusters');
}
export function fetchEvaluationOverview(county = '') {
  return get<EvalOverview>(`/api/evaluation/overview${county ? `?county=${encodeURIComponent(county)}` : ''}`);
}
export function fetchEvaluationDetail(applicationNumber: string) {
  return get<{ ok: boolean; data: EvalDetail }>(`/api/evaluation/clusters/${encodeURIComponent(applicationNumber)}`).then((r) => r.data);
}

/** Downloads a file from the API (PDF or ZIP) with the login cookie, then saves it. */
async function download(path: string, fallbackName: string) {
  const res = await fetch(`${BASE}${path}`, { credentials: 'include' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Download failed (${res.status})`);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
export const downloadEvaluationReport = (applicationNumber: string) =>
  download(`/api/evaluation/clusters/${encodeURIComponent(applicationNumber)}/report.pdf`, `KJET-evaluation-${applicationNumber}.pdf`);
export const downloadEvaluationReports = () => download('/api/evaluation/reports.zip', 'KJET-evaluation-reports.zip');

// ── Finalists (the clusters shortlisted from all applications, per cohort) ──

export interface FinalistSplit { males: number | null; females: number | null; age_18_35: number | null; age_36_50: number | null; age_over_50: number | null }

export interface FinalistForm {
  members: Record<string, number | null>;
  employees: Record<string, number | null>;
  males: number | null;
  females: number | null;
  age_18_35: number | null;
  age_36_50: number | null;
  age_over_50: number | null;
  /** Cohort 2 forms give the gender and age split for every year; the Cohort 1 form gives one split. */
  demographics: Record<string, FinalistSplit> | null;
  women_owned: string | null;
  registration_status: string | null;
  constituency: string | null;
  ward: string | null;
}

export type FormStatus = 'ok' | 'wrong_application' | 'missing';

export interface Finalist {
  cohort: number;
  /** The finalist's key: the sheet's Application ID without "Applicant" ("297", "KJET-20251229171110-PYGB"). */
  applicant_id: string;
  /** The Application ID as the finalist sheet writes it, for example "applicant 297". */
  application_id: string | null;
  cluster_name: string | null;
  application_number: string | null;
  registration_number: string | null;
  registration_status: string | null;
  county: string;
  constituency: string | null;
  ward: string | null;
  value_chain: string | null;
  /** Cohort 2: what the evaluator wrote when the value chain is "Other". */
  other_value_chain: string | null;
  checks: { e1: string | null; e2: string | null; e3: string | null; e4: string | null; e5: string | null };
  /** Cohort 1: Pass or Fail. Cohort 2 has no such column (the Selected tab lists those who met the criteria): null. */
  result: string | null;
  reason: string | null;
  criteria: Array<{ code: string; label: string; rating: number | null; logic: string | null }>;
  disqualifier: string | null;
  tier: string | null;
  normalized: Array<{ code: string; value: number | null }>;
  weighted: Array<{ code: string; value: number | null }>;
  total: number | null;
  /** Cohort 2 only. */
  equity_points: number | null;
  penalty: number | null;
  composite: number | null;
  rank: number | null;
  evaluator: string | null;
  track_years: number | null;
  rank_in_county: number | null;
  sheet_link: string;
  drive_link: string | null;
  drive_file: string | null;
  /** Cohort 2: phone and e-mail from the sheet's Final Contact Info tab. */
  contact: { phone: string | null; alt_phone: string | null; email: string | null } | null;
  /** Things worth knowing about this finalist's data, in words (a blank tier filled from another tab, a Drive link that was not used...). */
  flags: string[];
  /** Only filled when the application folder on disk really is this finalist's own. */
  form: FinalistForm | null;
  form_status: FormStatus;
  form_note: string | null;
  form_notes: string[];
  /** What the bundle's own MISSING_FILES_REPORT.txt says could not be found. */
  missing_files: Array<{ type: string; count: number }> | null;
  documents: { total: number; by_type: Record<string, number>; financial_types: string[] };
}

export interface FinalistSheetStatus {
  enabled?: boolean; sheet_name: string | null; sheet_modified: string | null; last_checked: string | null; last_imported: string | null; last_error: string | null;
}

/** The rules the sheet prints in its own headings, line by line. */
export interface FinalistRules { eligibility: string[]; disqualifiers: string[]; tiers: string[]; financial_evidence: string[] }

export interface FinalistListResponse {
  ok: boolean;
  data: Finalist[];
  meta: { sheet: FinalistSheetStatus; sheet_link: string; forms_read: number; forms_wrong: number; rules: FinalistRules };
}

export interface FinalistDetail extends Finalist {
  folder: string | null;
  questions: Array<{ n: number; question: string; answer: string; section: string }>;
  documents_list: Array<{ index: number; name: string; type: string; size: number }>;
}

export const fetchFinalists = (cohort: number) => get<FinalistListResponse>(`/api/finalists/${cohort}`);
export const fetchFinalistDetail = (cohort: number, applicantId: string) =>
  get<{ ok: boolean; data: FinalistDetail }>(`/api/finalists/${cohort}/${encodeURIComponent(applicantId)}`).then((r) => r.data);
/** Address of one document of a finalist: opens in the browser with the login cookie. */
export const finalistDocumentUrl = (cohort: number, applicantId: string, index: number) => `${BASE}/api/finalists/${cohort}/${encodeURIComponent(applicantId)}/documents/${index}`;
