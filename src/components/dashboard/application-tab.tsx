import type { ReactNode } from 'react';
import { money, number } from '@/data/portfolio';
import type { ClusterDetail } from '@/data/api';

type V = string | number | boolean | null | undefined;
type Row = Record<string, V>;

/** Everything in the application that the other tabs do not show. Loosely typed on purpose: it only displays what was submitted. */
interface App {
  organization_name?: V; signatories?: V; executives_ownership?: V; insurance?: V; prior_funding?: V;
  current_applications?: V; current_applications_detail?: V; submitted_at?: V; created_at_mis?: V;
  declaration_name?: V; declaration_position?: V; declaration_date?: V; declaration_acknowledged?: V; commitments_ticked?: V; commitments_total?: V;
  goal_1?: V; goal_2?: V; goal_3?: V; goal_4?: V; goal_5?: V;
  problem_addressed?: V; without_grant_alternative?: V; why_now?: V; implementation_timeline?: V; capacity_ability_explanation?: V;
  key_assumption_1?: V; key_assumption_2?: V; key_assumption_3?: V; key_assumption_4?: V; key_assumption_5?: V;
  payback_period_years?: V; payback_period_notes?: V; irr_pct?: V; irr_notes?: V; npv_kes?: V; npv_notes?: V;
  business?: Row | null; impact?: Row | null; sustainability?: Row | null;
  products?: Row[]; buyers?: Row[]; quotations?: Row[]; risks?: Row[]; pl?: Row[]; cashflow?: Row[]; balancesheet?: Row[];
  activities?: Row[]; vehicles?: Row[];
  [key: string]: unknown;
}

const has = (v: V) => v != null && String(v).trim() !== '';
const kes = (v: V) => (has(v) && Number.isFinite(Number(v)) ? money(Number(v), false) : '-');
const num = (v: V) => (has(v) && Number.isFinite(Number(v)) ? number(Number(v)) : '-');
const txt = (v: V) => (has(v) ? String(v) : '-');
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function Section({ title, children, show = true }: { title: string; children: ReactNode; show?: boolean }) {
  if (!show) return null;
  return <section className="profile-section"><h3>{title}</h3>{children}</section>;
}
function KV({ label, value }: { label: string; value: V }) {
  if (!has(value)) return null;
  return <div><div className="detail-label">{label}</div><div className="detail-value">{String(value)}</div></div>;
}
function Para({ label, value }: { label: string; value: V }) {
  if (!has(value)) return null;
  return <div className="app-para"><div className="detail-label">{label}</div><p>{String(value)}</p></div>;
}
function Table({ head, rows, numeric = [] }: { head: string[]; rows: ReactNode[][]; numeric?: number[] }) {
  return (
    <div className="app-table-wrap">
      <table className="portfolio-table app-table">
        <thead><tr>{head.map((h, i) => <th key={h} className={numeric.includes(i) ? 'gr-num' : undefined}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r['map']((c, j) => <td key={j} className={numeric.includes(j) ? 'gr-num' : undefined}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export function ApplicationTab({ cluster }: { cluster: ClusterDetail }) {
  const a = cluster as unknown as App;
  const b = a.business ?? {};
  const im = a.impact ?? {};
  const pl = a.pl ?? [];
  const bs = a.balancesheet ?? [];
  const cf = a.cashflow ?? [];
  const assumptions = [a.key_assumption_1, a.key_assumption_2, a.key_assumption_3, a.key_assumption_4, a.key_assumption_5].filter(has);
  const goals = [a.goal_1, a.goal_2, a.goal_3, a.goal_4, a.goal_5].filter(has);
  const budget = ([
    ['Productive assets', 'budget_productive_assets'], ['Services', 'budget_services'], ['Working capital', 'budget_working_capital'],
    ['Land and buildings', 'budget_land_buildings'], ['Pre-operating expenses', 'budget_preop_expenses'],
  ] as const).map(([label, k]) => ({ label, amount: (a as Row)[k], pct: (a as Row)[`${k}_pct`] })).filter((x) => has(x.amount));
  const before = (label: string, today: V, after: V) => (has(today) || has(after) ? [label, txt(today), txt(after)] : null);
  const ops = [
    before('Daily output', im['daily_output_today'], im['daily_output_after']), before('Capacity used (%)', im['capacity_today_pct'], im['capacity_after_pct']),
    before('Reject rate (%)', im['reject_rate_today'], im['reject_rate_after']), before('Energy use', im['energy_today'], im['energy_after']),
    before('Labour', im['labour_today'], im['labour_after']), before('Quality', im['quality_today'], im['quality_after']),
  ].filter((x): x is string[] => x != null);
  const uplift = [1, 2, 3].map((y) => ({ y, units: im[`sales_uplift_y${y}_units`], revenue: im[`sales_uplift_y${y}_revenue`], why: im[`sales_uplift_y${y}_assumptions`] })).filter((u) => has(u.units) || has(u.revenue));
  const plRows: Array<[string, string]> = [['Revenue', 'revenue'], ['Cost of goods sold', 'cogs'], ['Gross profit', 'gross_profit'], ['Salaries', 'salaries'], ['Rent', 'rent'], ['Marketing', 'marketing'], ['Other operating costs', 'other_opex'], ['EBITDA', 'ebitda'], ['Depreciation', 'depreciation'], ['Net profit', 'net_profit']];
  const bsRows: Array<[string, string]> = [['Cash', 'asset_cash'], ['Receivables', 'asset_receivables'], ['Inventory', 'asset_inventory'], ['Fixed assets (net)', 'asset_fixed_assets_net'], ['Payables', 'liab_payables'], ['Loans', 'liab_loans'], ['Members contributions', 'equity_members_contrib'], ['Retained earnings', 'equity_retained_earnings']];

  return (
    <>
      <Section title="Why this investment (counterfactual)" show={[a.problem_addressed, a.without_grant_alternative, a.why_now, a.implementation_timeline, a.capacity_ability_explanation].some(has) || assumptions.length > 0}>
        <Para label="What problem or opportunity the investment addresses" value={a.problem_addressed} />
        <Para label="What the cluster would do without the matching grant" value={a.without_grant_alternative} />
        <Para label="Why now" value={a.why_now} />
        <Para label="Implementation timeline" value={a.implementation_timeline} />
        <Para label="Ability to use the extra capacity" value={a.capacity_ability_explanation} />
        {assumptions.length > 0 && <div className="app-para"><div className="detail-label">Key assumptions</div><ol className="app-list">{assumptions.map((t, i) => <li key={i}>{String(t)}</li>)}</ol></div>}
      </Section>

      <Section title="Implementation schedule" show={(a.activities ?? []).length > 0 || (a.vehicles ?? []).length > 0}>
        {(a.activities ?? []).length > 0 && (
          <div className="app-table-wrap">
            <table className="portfolio-table app-table">
              <thead><tr><th>Activity</th>{MONTHS.map((m) => <th key={m} className="app-month">{m}</th>)}</tr></thead>
              <tbody>
                {(a.activities ?? []).map((r) => {
                  const on = String(r['months'] ?? '').split(',');
                  return <tr key={String(r['item_order'])}><td>{txt(r['activity'])}</td>{MONTHS.map((m) => <td key={m} className="app-month">{on.includes(m) ? <i className="app-dot" /> : ''}</td>)}</tr>;
                })}
              </tbody>
            </table>
          </div>
        )}
        {(a.vehicles ?? []).map((v) => <Para key={String(v['item_order'])} label={`Vehicle ${v['item_order']}: why it is needed`} value={v['details']} />)}
      </Section>

      <Section title="Business and market" show={Object.values(b).some(has)}>
        <div className="detail-grid">
          <KV label="Market geography" value={b['market_geography']} />
          <KV label="Market size" value={b['market_size']} />
          <KV label="Installed capacity" value={has(b['installed_capacity']) ? `${num(b['installed_capacity'])} ${txt(b['installed_capacity_unit'])}` : null} />
          <KV label="Current output" value={has(b['current_output']) ? `${num(b['current_output'])} ${txt(b['current_output_unit'])}` : null} />
          <KV label="Capacity utilisation" value={has(b['capacity_utilisation_pct']) ? `${b['capacity_utilisation_pct']}%` : null} />
          <KV label="Main bottleneck" value={b['main_bottleneck']} />
        </div>
        <Para label="Production process" value={b['production_process']} />
        <Para label="How prices are set" value={b['pricing_method']} />
        <Para label="Expected price changes" value={b['pricing_changes']} />
        {[b['competitor_1'], b['competitor_2'], b['competitor_3']].some(has) && (
          <div className="app-para"><div className="detail-label">Competitors</div><ol className="app-list">{[b['competitor_1'], b['competitor_2'], b['competitor_3']].filter(has).map((t, i) => <li key={i}>{String(t)}</li>)}</ol></div>
        )}
      </Section>

      <Section title="Products and services currently sold" show={(a.products ?? []).length > 0}>
        <Table head={['Product', 'Unit', 'Price (KES)', 'Active months']} numeric={[2]}
          rows={(a.products ?? []).map((p) => [txt(p['product_name']), txt(p['unit']), kes(p['price_kes']), txt(p['active_months'])])} />
      </Section>

      <Section title="Customers and market: main current buyers" show={(a.buyers ?? []).length > 0}>
        <Table head={['Buyer', 'Type', 'Annual volume', 'Unit price (KES)', 'Contract years']} numeric={[2, 3, 4]}
          rows={(a.buyers ?? []).map((r) => [txt(r['buyer_name']), txt(r['buyer_type']), num(r['annual_volume']), kes(r['unit_price']), txt(r['contract_years'])])} />
      </Section>

      <Section title="Supplier quotations" show={(a.quotations ?? []).length > 0}>
        <Table head={['Item', 'Quote 1', 'Quote 2', 'Quote 3', 'Selected', 'Supplier', 'Reason']} numeric={[1, 2, 3, 4]}
          rows={(a.quotations ?? []).map((q) => [txt(q['item_name']), kes(q['quote_1']), kes(q['quote_2']), kes(q['quote_3']), kes(q['selected_price']), txt(q['supplier']), txt(q['selection_reason'])])} />
      </Section>

      <Section title="Budget by category" show={budget.length > 0}>
        <Table head={['Category', 'Amount (KES)', 'Share']} numeric={[1, 2]}
          rows={budget.map((x) => [x.label, kes(x.amount), has(x.pct) ? `${Number(x.pct).toFixed(1)}%` : '-'])} />
      </Section>

      <Section title="Cluster-level profit and loss and balance sheet projection" show={pl.length > 0 || bs.length > 0}>
        {pl.length > 0 && (
          <>
            <div className="detail-label">Profit and loss, without and with the investment (KES)</div>
            <Table head={['Line', ...pl.flatMap((r) => [`Y${r['year']} without`, `Y${r['year']} with`])]} numeric={pl.flatMap((_, i) => [1 + i * 2, 2 + i * 2])}
              rows={plRows.map(([label, k]) => [label, ...pl.flatMap((r) => [kes(r[`${k}_without`]), kes(r[`${k}_with`])])])} />
          </>
        )}
        {bs.length > 0 && (
          <>
            <div className="detail-label" style={{ marginTop: 14 }}>Balance sheet (KES)</div>
            <Table head={['Line', ...bs.map((r) => `Year ${r['year']}`)]} numeric={bs.map((_, i) => i + 1)}
              rows={bsRows.map(([label, k]) => [label, ...bs.map((r) => kes(r[k]))])} />
          </>
        )}
      </Section>

      <Section title="Cash flow projection (KES)" show={cf.length > 0}>
        <Table head={['Month', 'Opening cash', 'Sales inflows', 'Equipment payments', 'Closing cash']} numeric={[1, 2, 3, 4]}
          rows={cf.map((r) => [`Year ${r['year']}, month ${r['month']}`, kes(r['opening_cash_balance']), kes(r['sales_inflows']), kes(r['equipment_payments']), kes(r['closing_cash_balance'])])} />
      </Section>

      <Section title="Investment metrics (machinery only)" show={[a.payback_period_years, a.irr_pct, a.npv_kes].some(has)}>
        <div className="detail-grid">
          <KV label="Payback period (years)" value={a.payback_period_years} />
          <KV label="Internal rate of return" value={has(a.irr_pct) ? `${a.irr_pct}%` : null} />
          <KV label="Net present value" value={has(a.npv_kes) ? kes(a.npv_kes) : null} />
        </div>
        <Para label="Payback notes" value={a.payback_period_notes} />
        <Para label="IRR notes" value={a.irr_notes} />
        <Para label="NPV notes" value={a.npv_notes} />
      </Section>

      <Section title="Productivity uplift and sales uplift" show={ops.length > 0 || uplift.length > 0}>
        {ops.length > 0 && <Table head={['Measure', 'Today', 'After the investment']} rows={ops} />}
        {uplift.length > 0 && (
          <>
            <div className="detail-label" style={{ marginTop: 14 }}>Sales uplift</div>
            <Table head={['Year', 'Extra units', 'Extra revenue (KES)', 'Assumptions']} numeric={[1, 2]}
              rows={uplift.map((u) => [`Year ${u.y}`, num(u.units), kes(u.revenue), txt(u.why)])} />
          </>
        )}
        <Para label="Local sourcing" value={im['impact_local_sourcing']} />
        <Para label="Skills transfer" value={im['impact_skills_transfer']} />
        <Para label="Environmental" value={im['impact_environmental']} />
        <Para label="Food security" value={im['impact_food_security']} />
        <Para label="Other" value={im['impact_other']} />
      </Section>

      <Section title="Risks and mitigation" show={(a.risks ?? []).length > 0}>
        <Table head={['Risk', 'Likelihood', 'Impact', 'Phase', 'Mitigation']}
          rows={(a.risks ?? []).map((r) => [txt(r['risk_category']), txt(r['likelihood']), txt(r['impact']), txt(r['phase']), txt(r['mitigation'])])} />
      </Section>

      <Section title="Sustainability and continuation" show={has(a.sustainability?.['sustainability_plan'])}>
        <p>{String(a.sustainability?.['sustainability_plan'])}</p>
      </Section>

      <Section title="Compliance, commitments and declaration by the Authorized Representative" show>
        <div className="detail-grid">
          <KV label="Applicant organization" value={a.organization_name} />
          <KV label="Submitted" value={has(a.submitted_at) ? String(a.submitted_at).slice(0, 10) : null} />
          <KV label="Insurance held" value={a.insurance} />
          <KV label="Declaration by the Authorized Representative" value={has(a.declaration_name) ? `${a.declaration_name}${has(a.declaration_position) ? `, ${a.declaration_position}` : ''}` : null} />
          <KV label="Declaration date" value={has(a.declaration_date) ? String(a.declaration_date).slice(0, 10) : null} />
          <KV label="Declaration acknowledged" value={a.declaration_acknowledged == null ? null : a.declaration_acknowledged ? 'Yes' : 'No'} />
          <KV label="Commitments ticked (Section 8)" value={has(a.commitments_total) && Number(a.commitments_total) > 0 ? `${a.commitments_ticked} of ${a.commitments_total}` : null} />
        </div>
        <Para label="Account signatories" value={a.signatories} />
        <Para label="Executives' ownership" value={a.executives_ownership} />
        <Para label="Prior funding" value={a.prior_funding} />
        <Para label="Other applications" value={has(a.current_applications) ? `${a.current_applications === true || a.current_applications === 'true' ? 'Yes' : 'No'}${has(a.current_applications_detail) ? `: ${a.current_applications_detail}` : ''}` : null} />
        {goals.length > 0 && <div className="app-para"><div className="detail-label">Goals</div><ol className="app-list">{goals.map((t, i) => <li key={i}>{String(t)}</li>)}</ol></div>}
      </Section>
    </>
  );
}
