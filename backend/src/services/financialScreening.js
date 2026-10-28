/**
 * financialScreening.js
 *
 * The 50-50 co-investment screening, worked out from three figures only, as the evaluators recorded them
 * in the Financial_Screening tab: Total investment, Cluster contribution and KJET matching contribution
 * (Evaluation (1)). Nothing depends on the MSEA portal, so no machinery or services subtotal, Section 5
 * budget, portal figure or document check enters the result.
 *
 * Result, in this order:
 *   FOLLOW-UP: data error      a figure is missing, the grant is zero or less, the amounts look like
 *                              placeholders, or total is not contribution plus grant (within KES 100)
 *   FOLLOW-UP: exceeds cap     the matching grant is above the Window 2 ceiling (KES 32M)
 *   NON-COMPLIANT: <50% cash   the cluster cash contribution is under 50% of the total investment
 *   PASS                       none of the above
 * Window 1 (Growth Window) is a matching grant up to KES 5M, Window 2 (Transformational Window) up to KES 32M.
 */

export const RULES = {
  category1Max: 5_000_000,        // Window 1 (Growth Window): matching grant up to this (US$40,000)
  category2Max: 32_000_000,       // Window 2 (Transformational Window): up to this (US$250,000); above it is over the ceiling
  minClusterShare: 0.5,           // cluster cash must be at least this share of the total
  maxKjetShare: 0.5,              // KJET share of eligible cost
  shareTolerance: 0.001,
  arithmeticTolerance: 100,       // KES
  minTotalCost: 50_000,           // below this the total looks like a placeholder
  minContribution: 1_000,
};

const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const fmt = (n) => Math.round(n).toLocaleString('en-US');

/**
 * @param {{total, contribution, grant}} f  Total investment, cluster contribution and KJET matching contribution (KES)
 */
export function screenFinancials(f) {
  const total = num(f.total);
  const contribution = num(f.contribution);
  const grant = num(f.grant);
  const complete = total != null && grant != null && contribution != null;

  const category = !complete ? 'Incomplete data'
    : grant <= 0 ? 'Invalid grant (zero or less)'
      : grant <= RULES.category1Max ? 'Window 1 (Growth Window)'
        : grant <= RULES.category2Max ? 'Window 2 (Transformational Window)' : 'Above the Window 2 ceiling';

  const sumDiff = complete ? total - (contribution + grant) : null;          // total minus contribution plus grant
  const arithmeticOk = sumDiff != null && Math.abs(sumDiff) <= RULES.arithmeticTolerance;
  const implausible = total != null && contribution != null && grant != null
    && (total < RULES.minTotalCost || contribution < RULES.minContribution || grant < 0);

  const clusterShare = total > 0 && contribution != null ? contribution / total : null;
  const kjetShare = total > 0 && grant != null ? grant / total : null;
  const meets50 = clusterShare != null ? clusterShare >= RULES.minClusterShare - RULES.shareTolerance : null;

  const maxEligible = total > 0 ? Math.min(total * RULES.maxKjetShare, RULES.category2Max) : null;
  const grantAboveMax = maxEligible != null && grant != null ? Math.max(0, grant - maxEligible) : null;
  const minCash = maxEligible != null ? total - maxEligible : null;
  const shortfall = minCash != null && contribution != null ? Math.max(0, minCash - contribution) : null;

  const issues = [];
  if (category === 'Incomplete data') issues.push('Missing total or grant figures');
  if (category === 'Invalid grant (zero or less)') issues.push('Matching grant requested is zero or negative');
  if (implausible) issues.push('Implausible or placeholder amounts: check units');
  if (sumDiff != null && Math.abs(sumDiff) > RULES.arithmeticTolerance) issues.push(`Total differs from cluster cash contribution plus matching grant by KES ${fmt(Math.abs(sumDiff))}`);
  if (meets50 === false) issues.push(`Cluster cash contribution is ${(clusterShare * 100).toFixed(1)}% of the project cost, below the 50% minimum`);
  if (category === 'Above the Window 2 ceiling') issues.push('Matching grant is above the Window 2 ceiling (KES 32M)');
  if (grantAboveMax > RULES.arithmeticTolerance && category !== 'Above the Window 2 ceiling') issues.push(`Matching grant requested is KES ${fmt(grantAboveMax)} above the maximum matching grant (50% of the project cost)`);

  let result = 'PASS';
  if (category === 'Incomplete data' || category === 'Invalid grant (zero or less)' || implausible || !arithmeticOk) result = 'FOLLOW-UP: data error';
  else if (category === 'Above the Window 2 ceiling') result = 'FOLLOW-UP: exceeds cap';
  else if (meets50 === false) result = 'NON-COMPLIANT: <50% cash';

  return {
    result, category, issues,
    figures: { total, contribution, grant },
    checks: {
      contribution_plus_grant: complete ? contribution + grant : null,
      total_minus_contribution_and_grant: sumDiff,
      arithmetic_consistent: complete ? arithmeticOk : null,
      implausible_amounts: implausible,
      cluster_share: clusterShare,
      kjet_share: kjetShare,
      meets_50_percent_cash: meets50,
      max_eligible_grant: maxEligible,
      grant_above_max: grantAboveMax,
      min_cluster_cash: minCash,
      contribution_shortfall: shortfall,
    },
  };
}
