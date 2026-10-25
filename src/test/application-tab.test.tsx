import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApplicationTab } from '@/components/dashboard/application-tab';
import type { ClusterDetail } from '@/data/api';

const cluster = {
  problem_addressed: 'Milk is lost to spoilage', why_now: 'Buyers are waiting', key_assumption_1: 'Prices stay stable',
  budget_productive_assets: '1000000', budget_productive_assets_pct: '80', payback_period_years: '3.5', irr_pct: '21',
  organization_name: 'Kisima Dairies', declaration_name: 'Justus Kinoti', declaration_position: 'Chairperson', declaration_date: '2026-09-07',
  declaration_acknowledged: true, commitments_ticked: 18, commitments_total: 18,
  business: { market_geography: 'Meru and Nairobi', competitor_1: 'Brookside', pricing_method: 'Cost plus 20%' },
  products: [{ product_name: 'Milk', unit: 'litre', price_kes: '60', active_months: '12' }],
  buyers: [{ buyer_name: 'Quickmart', buyer_type: 'supermarket', annual_volume: '1000', unit_price: '55', contract_years: '3' }],
  risks: [{ risk_category: 'Theft', likelihood: 'Low', impact: 'High', phase: 'Operation', mitigation: 'Guards' }],
  activities: [{ item_order: 1, activity: 'Install the pasteurizer', months: 'jan,feb' }],
  vehicles: [{ item_order: 1, details: 'A pickup is needed for deliveries' }],
  pl: [{ year: 1, revenue_with: '5000000', revenue_without: '3000000' }],
  impact: { daily_output_today: '500', daily_output_after: '900', sales_uplift_y1_revenue: '1200000' },
} as unknown as ClusterDetail;

describe('Application tab', () => {
  it('shows the parts of the application the other tabs do not', () => {
    render(<ApplicationTab cluster={cluster} />);
    expect(screen.getByText('Milk is lost to spoilage')).toBeTruthy();
    expect(screen.getByText('Install the pasteurizer')).toBeTruthy();
    expect(screen.getByText('A pickup is needed for deliveries')).toBeTruthy();
    expect(screen.getByText('Brookside')).toBeTruthy();
    expect(screen.getByText('Quickmart')).toBeTruthy();
    expect(screen.getByText('Theft')).toBeTruthy();
    expect(screen.getByText('18 of 18')).toBeTruthy();
    expect(screen.getByText('Justus Kinoti, Chairperson')).toBeTruthy();
  });

  it('leaves out sections the applicant did not fill', () => {
    render(<ApplicationTab cluster={{ organization_name: 'X' } as unknown as ClusterDetail} />);
    expect(screen.queryByText('Supplier quotations')).toBeNull();
    expect(screen.queryByText('Risks and mitigation')).toBeNull();
    expect(screen.getByText('Compliance, commitments and declaration by the Authorized Representative')).toBeTruthy();
  });
});
