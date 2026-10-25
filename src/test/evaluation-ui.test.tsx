import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

// Recharts measures its container with ResizeObserver, which jsdom does not provide
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
import { EligibilityPage, EvaluationOverview, FinancialScreeningPage, ScorecardPage } from '@/components/dashboard/evaluation-pages';
import { gateTone, scoreTone } from '@/components/dashboard/evaluation-ui';
import type { EvalListResponse, EvalOverview, EvalRow } from '@/data/api';

describe('evaluation status colours', () => {
  it('maps gate values to a tone', () => {
    expect(gateTone('PASS')).toBe('good');
    expect(gateTone('Pass')).toBe('good');
    expect(gateTone('READY')).toBe('good');
    expect(gateTone('FOLLOW-UP: data error')).toBe('warn');
    expect(gateTone('HOLD')).toBe('warn');
    expect(gateTone('Hold')).toBe('warn');
    expect(gateTone('Referred with Comments')).toBe('warn');
    expect(gateTone('NON-COMPLIANT: <50% cash')).toBe('bad');
    expect(gateTone('FAIL')).toBe('bad');
    expect(gateTone('Rejected')).toBe('bad');
    expect(gateTone('')).toBe('neutral');
    expect(gateTone(null)).toBe('neutral');
  });

  it('follows the score rule: 70 recommended, 50 referred, below that rejected', () => {
    expect(scoreTone(96)).toBe('good');
    expect(scoreTone('70')).toBe('good');
    expect(scoreTone(69.9)).toBe('warn');
    expect(scoreTone(50)).toBe('warn');
    expect(scoreTone(49)).toBe('bad');
    expect(scoreTone(null)).toBe('neutral');
  });
});

const fin = (over: Partial<EvalRow['financial']> = {}) => ({
  result: 'PASS', category: 'Category 2', issues: [], total: 1000, contribution: 500, grant: 500, machinery: 1000, services: 0,
  contribution_plus_grant: 1000, total_minus_contribution_and_grant: 0, total_minus_machinery_and_services: 0, arithmetic_consistent: true,
  implausible_amounts: false, cluster_share: 0.5, kjet_share: 0.5, meets_50_percent_cash: true, max_eligible_grant: 500, grant_above_max: 0,
  min_cluster_cash: 500, contribution_shortfall: 0, document_check: 'Complete', ...over,
});
const tests = (e5 = 'Pass') => ({ E1: 'Pass', E2: 'Pass', E3: 'Pass', E4: 'Pass', E5: e5, E6: 'Pass', E7: 'Pass', E8: 'Pass', E9: 'Pass', E10: 'Pass' });
const criteria = [20, 40, 15, 10, 10, 5].map((w, i) => ({ code: `C${i + 1}`, weight: w, rating: 4, score: w * 0.8 }));

const alpha = {
  application_number: 'KJET-2026-000001', cluster_name: 'ALPHA DAIRY', county: 'Nyeri', constituency: 'X', value_chain: 'Dairy', legal_form: 'cooperative',
  score: 81, band: 'Recommended', rank: 1, county_rank: 1, eligibility: 'PASS',
  criteria, tests: tests(), financial: fin(), members: 100, women: 40, youth: 20, pwd: 1, jobs_today: 10, jobs_year3: 30,
} as EvalRow;
const beta = {
  ...alpha, application_number: 'KJET-2026-000002', cluster_name: 'BETA STONE', county: 'Baringo', value_chain: 'Construction', score: 48, band: 'Rejected',
  rank: null, county_rank: null, eligibility: 'HOLD', tests: tests('Hold'),
  financial: fin({
    result: 'NON-COMPLIANT: <50% cash', total: 15876000, grant: 8038000, contribution: 7838000, cluster_share: 0.4937, meets_50_percent_cash: false,
    contribution_shortfall: 100000, grant_above_max: 100000, issues: ['Cluster cash share is 49.4%, below the 50% minimum'],
  }),
} as EvalRow;

const list = {
  ok: true, data: [alpha, beta],
  meta: { source_file: 'sheet', imported_at: '2026-10-25T10:00:00Z', evaluated: 2, sheet: { enabled: true, sheet_name: 'Evaluation Tool', sheet_modified: '2026-10-25T09:00:00Z', last_checked: null, last_imported: null, last_error: null } },
  criteria: [],
} as unknown as EvalListResponse;

const overview = {
  ok: true, meta: list.meta, average_score: 64.5, cash_shortfall_clusters: 1,
  funnel: [{ stage: 'Evaluated', count: 2 }, { stage: 'Financial screening: pass', count: 1 }, { stage: 'Eligibility: pass', count: 1 }, { stage: 'Score 70 or more', count: 1 }],
  bands: [{ band: 'Recommended', count: 1 }, { band: 'Rejected', count: 1 }], eligibility: [], categories: [],
  financial_results: [{ result: 'PASS', count: 1 }, { result: 'NON-COMPLIANT: <50% cash', count: 1 }],
  score_distribution: [{ label: '40-49', count: 1 }, { label: '80-89', count: 1 }],
  criteria_average: [{ code: 'C1', label: 'Overall cluster performance and viability', weight: 20, average: 15 }],
  tests: [{ test: 'E5', label: 'Cost share', pass: 1, hold: 1, fail: 0 }],
  counties: [{ name: 'Nyeri', count: 1, average_score: 81, eligible: 1 }], value_chains: [{ name: 'Dairy', count: 1, average_score: 81, eligible: 1 }],
  top_issues: [{ issue: 'Cluster cash below the 50% minimum', count: 1 }],
  top_eligible: [{ application_number: alpha.application_number, cluster_name: 'ALPHA DAIRY', county: 'Nyeri', score: 81, rank: 1 }],
} as unknown as EvalOverview;

function renderWith(ui: React.ReactElement) {
  const qc = new QueryClient();
  qc.setQueryData(['evaluation', 'list'], list);
  qc.setQueryData(['evaluation', 'overview'], overview);
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('Evaluation pages', () => {
  it('overview shows the funnel, the top eligible clusters and a report button for each', () => {
    renderWith(<EvaluationOverview onSelect={() => {}} />);
    expect(screen.getByText('Screening funnel')).toBeTruthy();
    expect(screen.queryByText(/grant-ready/i)).toBeNull();
    expect(screen.getByText('ALPHA DAIRY')).toBeTruthy();
    expect(screen.getByLabelText('Download evaluation report of ALPHA DAIRY')).toBeTruthy();
    expect(screen.queryByText(/Live from the online evaluation sheet/)).toBeNull();
  });

  it('financial screening shows Drive figures, the cash share and the shortfall, largest shortfall first', () => {
    renderWith(<FinancialScreeningPage onSelect={() => {}} />);
    const names = screen.getAllByText(/ALPHA DAIRY|BETA STONE/).map((n) => n.textContent ?? '');
    expect(names[0]).toContain('BETA STONE');
    expect(screen.getByText('49.4%')).toBeTruthy();
    expect(screen.getByText(/short by KES 100,000/)).toBeTruthy();
    expect(screen.getAllByText('NON-COMPLIANT: <50% cash').length).toBeGreaterThan(0);
  });

  it('financial screening filters by result', () => {
    renderWith(<FinancialScreeningPage onSelect={() => {}} />);
    fireEvent.change(screen.getByLabelText('Filter by result'), { target: { value: 'PASS' } });
    expect(screen.queryByText('BETA STONE')).toBeNull();
    expect(screen.getByText('ALPHA DAIRY')).toBeTruthy();
  });

  it('eligibility lists the ten tests and filters to a test on hold', () => {
    renderWith(<EligibilityPage onSelect={() => {}} />);
    expect(screen.getAllByTitle(/^E5: /)).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('Filter by test needing attention'), { target: { value: 'E5' } });
    expect(screen.queryByText('ALPHA DAIRY')).toBeNull();
    const row = screen.getByText('BETA STONE').closest('tr')!;
    expect(within(row).getByText(/attention: E5/)).toBeTruthy();
  });

  it('scorecard shows points per criterion, highest score first, and no grant-ready label', () => {
    renderWith(<ScorecardPage onSelect={() => {}} />);
    const names = screen.getAllByText(/ALPHA DAIRY|BETA STONE/).map((n) => n.textContent ?? '');
    expect(names[0]).toContain('ALPHA DAIRY');
    expect(screen.queryByText(/grant-ready/i)).toBeNull();
    expect(screen.getAllByText('C2').length).toBeGreaterThan(0);
  });

  it('does not show assessor or reviewer names anywhere', () => {
    const { container } = renderWith(<ScorecardPage onSelect={() => {}} />);
    expect(container.textContent).not.toMatch(/assessor|reviewer/i);
  });
});
