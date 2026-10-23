import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GrantReady } from '@/components/dashboard/grant-ready';
import { gateTone, scoreTone } from '@/components/dashboard/evaluation-ui';
import type { EvaluationResponse, ShortlistRow } from '@/data/api';

describe('evaluation status colours', () => {
  it('maps gate values to a tone', () => {
    expect(gateTone('PASS')).toBe('good');
    expect(gateTone('READY')).toBe('good');
    expect(gateTone('Recommended – subject to DD / E&S clearance')).toBe('good');
    expect(gateTone('FOLLOW-UP: data error')).toBe('warn');
    expect(gateTone('Hold – eligibility clarification')).toBe('warn');
    expect(gateTone('In progress')).toBe('warn');
    expect(gateTone('Gaps outstanding')).toBe('warn');
    expect(gateTone('NON-COMPLIANT: <50% cash')).toBe('bad');
    expect(gateTone('Not eligible')).toBe('bad');
    expect(gateTone('Not recommended – safeguards')).toBe('bad');
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

const base = {
  shortlisted: true, band: 'Recommended', rank: 1, county_rank: 1, category: 'Category 2',
  financial_screening: 'PASS', data_readiness: 'READY', eligibility: 'PASS', due_diligence: 'In progress',
  exclusion_status: null, es_disposition: null, system_recommendation: 'Recommended – subject to DD / E&S clearance',
  technical_rec: 'Recommended', msea_decision: null, approved_grant: null, wb_status: null, conditions: null,
  eval_total_cost: '1000', eval_grant_requested: '500', eval_value_chain: 'Dairy', constituency: 'X', legal_form: 'cooperative',
  total_project_cost: '1000', grant_requested: '500', cluster_contribution: '500', total_members: 100, women: 40, youth: 20, pwd: 1,
  jobs_today: 10, jobs_year3: 30, c1_rating: 4, c1_score: 16, c2_rating: 4, c2_score: 32, c3_rating: 4, c3_score: 12,
  c4_rating: 4, c4_score: 8, c5_rating: 4, c5_score: 8, c6_rating: 4, c6_score: 4, figure_notes: [],
} as unknown as ShortlistRow;

const sample = {
  ok: true,
  data: [
    { ...base, application_number: 'KJET-2026-000001', cluster_name: 'ALPHA DAIRY', county: 'Nyeri', value_chain: 'Dairy', total_score: 96, shortlist_rank: 1, max_eligible_grant: '500', shortlist_reason: 'Highest score in the portfolio.' },
    {
      ...base, application_number: 'KJET-2026-000002', cluster_name: 'BETA STONE', county: 'Baringo', value_chain: 'Construction', total_score: 71, shortlist_rank: 2,
      max_eligible_grant: '7938000', grant_requested: '8038000', es_disposition: 'Not eligible', due_diligence: 'Gaps outstanding',
      financial_screening: 'FOLLOW-UP: data error', system_recommendation: 'Not recommended – safeguards', shortlist_reason: 'Clear fit for the priority value chain.',
      figure_notes: [{ field: 'grant requested', evaluation: 7938000, drive: 8038000 }],
    },
  ],
  waiting: [{ application_number: 'KJET-2026-000009', cluster_name: 'GAMMA HOLD', county: 'Kiambu', value_chain: 'Dairy', total_score: 88, band: 'Recommended', rank: null, eligibility: 'HOLD', financial_screening: 'PASS', data_readiness: 'READY', system_recommendation: 'Hold – eligibility clarification' }],
  summary: { clusters: 2, average_score: 83.5, counties: 2, value_chains: 2, members: 200, women: 80, requested_per_drive: 8038500, eligible_grant: 7938500, projected_jobs_year3: 60 },
  bands: [{ band: 'Recommended', n: 3 }],
  meta: { source_file: 'workbook.xlsx', imported_at: '2026-10-24T10:00:00Z', evaluated: 85 },
} as unknown as EvaluationResponse;

function renderPage() {
  const qc = new QueryClient();
  qc.setQueryData(['evaluation'], sample);
  return render(<QueryClientProvider client={qc}><GrantReady onSelect={() => {}} /></QueryClientProvider>);
}

describe('Grant-ready page', () => {
  it('states that the clusters are recommended, not funded', () => {
    renderPage();
    expect(screen.getByText(/Recommended for grant support, not yet funded/)).toBeTruthy();
    expect(screen.getByText(/World Bank\s+no-objection/)).toBeTruthy();
  });

  it('lists the ranked clusters with their scores', () => {
    renderPage();
    expect(screen.getByText('ALPHA DAIRY')).toBeTruthy();
    expect(screen.getByText('BETA STONE')).toBeTruthy();
    expect(screen.getByText('96')).toBeTruthy();
    expect(screen.getByText('71')).toBeTruthy();
  });

  it('shows warnings openly instead of hiding them', () => {
    renderPage();
    expect(screen.getByText('Not eligible')).toBeTruthy();          // Besko-style E&S result
    expect(screen.getByText('Gaps outstanding')).toBeTruthy();
    expect(screen.getByText('Figures differ from Drive')).toBeTruthy();
  });

  it('expands a row to show why the cluster is listed', () => {
    renderPage();
    expect(screen.queryByText(/Highest score in the portfolio/)).toBeNull();
    fireEvent.click(screen.getAllByText('Why this cluster')[0]!);
    expect(screen.getByText(/Highest score in the portfolio/)).toBeTruthy();
  });

  it('explains high scorers that are on hold', () => {
    renderPage();
    expect(screen.getByText(/Scored 70 or more, eligibility still on hold \(1\)/)).toBeTruthy();
    expect(screen.getByText('GAMMA HOLD')).toBeTruthy();
  });
});
