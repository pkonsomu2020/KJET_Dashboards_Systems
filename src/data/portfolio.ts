// ── Pure formatting utilities ─────────────────────────────────
// No hardcoded data. No JSON import. All data comes from the API.

export const number = (value: number) =>
  new Intl.NumberFormat('en-KE').format(value);

export const money = (value: number, compact = true) => {
  if (!compact) return `KES ${number(Math.round(value))}`;
  if (value >= 1e9) return `KES ${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `KES ${(value / 1e6).toFixed(2)}M`;
  return `KES ${number(Math.round(value))}`;
};

export const percent = (part: number, total: number) =>
  total ? (part / total) * 100 : 0;

// ── CSV export (works with API cluster rows) ──────────────────
import type { ClusterRow } from './api';

export function exportCSV(rows: ClusterRow[]) {
  const fields = [
    'Application number', 'Cluster name', 'County', 'Constituency', 'Ward',
    'Value chain', 'Total project cost (KES)', 'Section 5 budget (KES)',
    'Grant requested (KES)', 'Cluster contribution (KES)',
    'Members', 'Women', 'Youth', 'PWD',
    'Jobs today', 'Jobs year 1', 'Jobs year 3', 'Financial review',
  ];
  const csv = [
    fields,
    ...rows.map(c => [
      c.application_number,
      c.cluster_name,
      c.county,
      c.constituency,
      c.ward,
      c.value_chain,
      c.total_project_cost,
      c.section5_budget_total,
      c.grant_requested,
      c.cluster_contribution,
      c.total_members,
      c.women,
      c.youth,
      c.pwd,
      c.jobs_today,
      c.jobs_year1,
      c.jobs_year3,
      c.compliance_status,
    ]),
  ]
    .map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\r\n');

  const url = URL.createObjectURL(
    new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = 'KJET-Cohort-1-portfolio.csv';
  a.click();
  URL.revokeObjectURL(url);
}
