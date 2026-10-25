/**
 * financialScreening.js
 *
 * The 50-50 co-investment checks, worked out from the application figures synced from Drive. These
 * are the same rules as the evaluation workbook's Financial_Screening tab (its Parameters sheet), so
 * the dashboard and the workbook agree whenever they are looking at the same numbers. The workbook's
 * own results are kept separately as the evaluator's findings.
 */

export const RULES = {
  category1Max: 5_000_000,        // Category 1: KJET contribution up to this
  category2Max: 32_000_000,       // Category 2: up to this; above it exceeds the cap
  minClusterShare: 0.5,           // cluster cash must be at least this share of the total
  maxKjetShare: 0.5,              // KJET share of eligible cost
  shareTolerance: 0.001,
  arithmeticTolerance: 100,       // KES
  minTotalCost: 50_000,           // below this the total looks like a placeholder
  minContribution: 1_000,
  budgetTolerance: 0.05,          // Section 5 budget may differ from the project cost by this share
};

const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const fmt = (n) => Math.round(n).toLocaleString('en-US');

/**
 * @param {{total, contribution, grant, machinery, services}} f  Drive figures (KES)
 * @param {{docCheck?: string|null}} [evaluator]  the evaluator's document check from the workbook
 */
export function screenFinancials(f, evaluator = {}) {
  const total = num(f.total);
  const contribution = num(f.contribution);
  const grant = num(f.grant);
  const s5 = num(f.s5);
  const hasParts = num(f.machinery) != null || num(f.services) != null;   // when neither subtotal is stated there is nothing to reconcile
  const machinery = num(f.machinery) ?? 0;
  const services = num(f.services) ?? 0;
  const complete = total != null && grant != null && contribution != null;

  const category = !complete ? 'Incomplete data'
    : grant <= 0 ? 'Invalid grant (≤0)'
      : grant <= RULES.category1Max ? 'Category 1'
        : grant <= RULES.category2Max ? 'Category 2' : 'Exceeds KES 32M cap';

  const sumDiff = complete ? total - (contribution + grant) : null;          // total minus contribution plus grant
  const partsDiff = total != null && hasParts ? total - (machinery + services) : null;   // total minus machinery plus services
  const arithmeticOk = sumDiff != null
    && Math.abs(sumDiff) <= RULES.arithmeticTolerance && (partsDiff == null || Math.abs(partsDiff) <= RULES.arithmeticTolerance);
  const implausible = total != null && contribution != null && grant != null
    && (total < RULES.minTotalCost || contribution < RULES.minContribution || grant < 0);

  const clusterShare = total > 0 && contribution != null ? contribution / total : null;
  const kjetShare = total > 0 && grant != null ? grant / total : null;
  const meets50 = clusterShare != null ? clusterShare >= RULES.minClusterShare - RULES.shareTolerance : null;

  const maxEligible = total > 0 ? Math.min(total * RULES.maxKjetShare, RULES.category2Max) : null;
  const grantAboveMax = maxEligible != null && grant != null ? Math.max(0, grant - maxEligible) : null;
  const minCash = maxEligible != null ? total - maxEligible : null;
  const shortfall = minCash != null && contribution != null ? Math.max(0, minCash - contribution) : null;

  const s5Differs = s5 != null && total != null && Math.abs(s5 - total) > Math.max(RULES.arithmeticTolerance, total * RULES.budgetTolerance);

  const docs = evaluator.docCheck ?? null;
  const docsMissing = typeof docs === 'string' && docs.startsWith('Missing');

  const issues = [];
  if (category === 'Incomplete data') issues.push('Missing total or grant figures');
  if (category === 'Invalid grant (≤0)') issues.push('KJET grant requested is zero or negative');
  if (implausible) issues.push('Implausible or placeholder amounts: check units');
  if (sumDiff != null && Math.abs(sumDiff) > RULES.arithmeticTolerance) issues.push(`Total differs from contribution plus grant by KES ${fmt(Math.abs(sumDiff))}`);
  if (partsDiff != null && Math.abs(partsDiff) > RULES.arithmeticTolerance) issues.push(`Total differs from machinery plus services by KES ${fmt(Math.abs(partsDiff))}`);
  if (s5Differs) issues.push(`Section 5 budget (KES ${fmt(s5)}) differs from the project cost`);
  if (meets50 === false) issues.push(`Cluster cash share is ${(clusterShare * 100).toFixed(1)}%, below the 50% minimum`);
  if (category === 'Exceeds KES 32M cap') issues.push('KJET grant is above the KES 32M maximum');
  if (grantAboveMax > RULES.arithmeticTolerance && category !== 'Exceeds KES 32M cap') issues.push(`Grant requested is KES ${fmt(grantAboveMax)} above the maximum eligible grant`);
  if (docsMissing) issues.push(docs.replace(/;\s*$/, ''));

  let result = 'PASS';
  if (category === 'Incomplete data' || category === 'Invalid grant (≤0)' || implausible || !arithmeticOk) result = 'FOLLOW-UP: data error';
  else if (category === 'Exceeds KES 32M cap') result = 'FOLLOW-UP: exceeds cap';
  else if (meets50 === false) result = 'NON-COMPLIANT: <50% cash';
  else if (docsMissing) result = 'FOLLOW-UP: documents';

  return {
    result, category, issues,
    figures: { total, contribution, grant, machinery: num(f.machinery), services: num(f.services) },
    checks: {
      contribution_plus_grant: complete ? contribution + grant : null,
      total_minus_contribution_and_grant: sumDiff,
      total_minus_machinery_and_services: partsDiff,
      arithmetic_consistent: complete ? arithmeticOk : null,
      implausible_amounts: implausible,
      cluster_share: clusterShare,
      kjet_share: kjetShare,
      meets_50_percent_cash: meets50,
      max_eligible_grant: maxEligible,
      grant_above_max: grantAboveMax,
      min_cluster_cash: minCash,
      contribution_shortfall: shortfall,
      document_check: docs,
      section5_budget: s5,
      section5_budget_differs: s5 == null ? null : s5Differs,
    },
  };
}
