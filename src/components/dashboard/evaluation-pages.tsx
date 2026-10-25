import { Fragment, useMemo, useState, type ReactNode } from 'react';
import {
  Award, ArrowUpRight, ChevronDown, ChevronUp, CircleDollarSign, ClipboardCheck, Info, ListChecks,
  Loader2, MapPin, Scale, SearchX, ShieldCheck, TriangleAlert, Search, RotateCcw,
} from 'lucide-react';
import { BarChart, Bar, CartesianGrid, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell } from 'recharts';
import { Button } from '@/components/ui/button';
import { money } from '@/data/portfolio';
import { useEvaluationList, useEvaluationOverview } from '@/hooks/usePortfolio';
import { useCountyFilter } from '@/hooks/useCountyFilter';
import type { EvalRow } from '@/data/api';
import { BandChip, ScoreBar, StatusChip, TestChips, gateTone } from './evaluation-ui';
import { EligibilityPanel, FinancialPanel, ScorePanel, WithDetail } from './evaluation-panels';
import { ReportButton, ReportsZipButton } from './report-buttons';
import { GroupScoreChart, RankedBars, ResultsDonut, TestsChart } from './evaluation-charts';

const tooltipStyle = { background: 'var(--card)', borderColor: 'var(--border)', borderRadius: 6, fontSize: 11, color: 'var(--foreground)' };
const kes = (v: number | null | undefined) => (v == null ? 'n/a' : money(v, false));
const pct = (v: number | null | undefined) => (v == null ? 'n/a' : `${(v * 100).toFixed(1)}%`);
const chain = (v: string) => v.replace(/_/g, ' ');

function Loading() {
  return (
    <div className="chart-panel" style={{ minHeight: 240, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Loader2 size={26} className="animate-spin text-muted-foreground" />
    </div>
  );
}
function Failed() {
  return <div className="notice"><Info size={16} /><span>The evaluation results could not be loaded. Please refresh the page.</span></div>;
}

function Tile({ label, value, icon: Icon, children }: { label: string; value: string; icon: typeof Award; children?: ReactNode }) {
  return (
    <article className="metric">
      <div className="metric-label"><span>{label}</span><Icon /></div>
      <div className="metric-value">{value}</div>
      <div className="metric-foot">{children}</div>
    </article>
  );
}

function Panel({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="chart-panel">
      <div className="panel-header">
        <div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
        {action}
      </div>
      <div className="panel-body">{children}</div>
    </section>
  );
}

// ── County filter panel (shared by every evaluation page) ──

function CountyFilter({ shown, children }: { shown?: number; children?: ReactNode }) {
  const [county, setCounty] = useCountyFilter();
  const { data } = useEvaluationList();
  const counties = useMemo(() => [...new Set((data?.data ?? []).map((r) => r.county))].sort(), [data]);
  return (
    <div className="ev-filterpanel">
      <label>
        <MapPin size={15} aria-hidden="true" />
        <span>County</span>
        <select className="filter-select" aria-label="Filter the evaluation by county" value={county} onChange={(e) => setCounty(e.target.value)}>
          <option value="">All counties</option>
          {counties.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      {county && (
        <Button type="button" variant="ghost" size="sm" onClick={() => setCounty('')}><RotateCcw />Clear</Button>
      )}
      <span className="ev-filterpanel-note">
        {county ? `Showing ${shown ?? (data?.data ?? []).filter((r) => r.county === county).length} cluster(s) in ${county}` : 'Showing every county'}
      </span>
      {children && <div className="ev-filterpanel-actions">{children}</div>}
    </div>
  );
}

// ── Overview ─────────────────────────────────────────────────

function Bar100({ value, max, tone = 'good' }: { value: number; max: number; tone?: 'good' | 'warn' | 'bad' | 'neutral' }) {
  return <span className="score-track"><i className={`tone-${tone}`} style={{ width: `${max ? Math.max(value ? 2 : 0, (value / max) * 100) : 0}%` }} /></span>;
}

export function EvaluationOverview({ onSelect }: { onSelect: (applicationNumber: string) => void }) {
  const [county] = useCountyFilter();
  const { data: o, isLoading, error } = useEvaluationOverview(county);
  if (isLoading) return <Loading />;
  if (error || !o) return <Failed />;
  if (o.meta.evaluated === 0 && !county) return <div className="empty-state"><SearchX size={30} /><p>No evaluation results have been loaded yet.</p></div>;

  const eligible = o.funnel.find((f) => f.stage === 'Eligibility: pass')?.count ?? 0;
  const recommended = o.bands.find((b) => b.band === 'Recommended')?.count ?? 0;
  const maxCount = o.funnel[0]?.count ?? 1;

  return (
    <>

      <CountyFilter shown={o.meta.evaluated}><ReportsZipButton label="Download all reports (ZIP)" /></CountyFilter>

      <div className="metrics-grid">
        <Tile label="Clusters evaluated" value={String(o.meta.evaluated)} icon={ClipboardCheck}><span>average score {o.average_score ?? 'n/a'} of 100</span></Tile>
        <Tile label="Eligible" value={String(eligible)} icon={ListChecks}><span>passed all ten tests</span></Tile>
        <Tile label="Recommended (70 or more)" value={String(recommended)} icon={Scale}><span>scored 70 or more</span></Tile>
        <Tile label="Financial screening pass" value={String(o.funnel[1]?.count ?? 0)} icon={CircleDollarSign}><span>of {o.meta.evaluated} clusters</span></Tile>
        <Tile label="Below 50% cluster cash" value={String(o.cash_shortfall_clusters)} icon={TriangleAlert}><span>cluster cash contribution under half</span></Tile>
      </div>

      <div className="analytics-grid">
        <Panel title="Screening funnel" subtitle="How many clusters clear each stage">
          <div className="funnel">
            {o.funnel.map((f, i) => (
              <div key={f.stage} className="funnel-row">
                <span className="funnel-label">{f.stage}</span>
                <span className="funnel-bar"><i style={{ width: `${Math.max(3, (f.count / maxCount) * 100)}%`, opacity: 1 - i * 0.14 }} /></span>
                <strong>{f.count}</strong>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Score distribution" subtitle="Number of clusters in each 10-point band">
          <div className="chart-box">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={o.score_distribution} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--muted)' }} />
                <Bar dataKey="count" name="Clusters" radius={[3, 3, 0, 0]}>
                  {o.score_distribution.map((b, i) => <Cell key={b.label} fill={i >= 7 ? 'var(--chart-1)' : i >= 5 ? 'var(--chart-3)' : 'var(--chart-5)'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <div className="analytics-grid">
        <Panel title="Eligibility tests E1 to E10" subtitle="Share of clusters that pass, are put on hold or fail each test">
          <TestsChart tests={o.tests} />
        </Panel>

        <Panel title="Average score by criterion" subtitle="Weighted points earned, out of the criterion's weight">
          <div className="eval-criteria">
            {o.criteria_average.map((k) => (
              <div className="eval-crit" key={k.code}>
                <span className="name">{k.code} {k.label}<small>weight {k.weight}</small></span>
                <span className="pts">{k.average ?? '-'} / {k.weight}</span>
                <span className="score-track"><i className="tone-good" style={{ width: `${k.average ? (k.average / k.weight) * 100 : 0}%` }} /></span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="analytics-grid" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
        <Panel title="Financial screening results" subtitle="Worked out from the application amounts as evaluated">
          <ResultsDonut
            items={o.financial_results.map((r) => ({ name: r.result, value: r.count }))}
            total={o.meta.evaluated} centreLabel="clusters screened" />
          <h4 className="ev-sub">Most common issues</h4>
          <RankedBars items={o.top_issues.map((i) => ({ name: i.issue, value: i.count }))} color="var(--chart-2)" labelWidth={230} />
        </Panel>
      </div>

      <div className="analytics-grid" style={county ? { gridTemplateColumns: 'minmax(0, 1fr)' } : undefined}>
        {!county && (
          <Panel title="Average score by county" subtitle="Counties with the most clusters; select to show all">
            <GroupScoreChart rows={o.counties} noun="county" />
          </Panel>
        )}
        <Panel title="Average score by value chain" subtitle="Dashed lines mark the 50 and 70 score thresholds">
          <GroupScoreChart rows={o.value_chains} format={chain} noun="value chain" />
        </Panel>
      </div>
    </>
  );
}

// ── Shared list shell: filters, search and expandable rows ─────

type Filters = { q: string; a: string; b: string };

function useRows(filterFn: (r: EvalRow, f: Filters) => boolean, sortFn?: (a: EvalRow, b: EvalRow) => number) {
  const { data, isLoading, error } = useEvaluationList();
  const [county] = useCountyFilter();
  const [f, setF] = useState<Filters>({ q: '', a: '', b: '' });
  const rows = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    const out = (data?.data ?? []).filter((r) =>
      (!county || r.county === county) && (!q || r.cluster_name.toLowerCase().includes(q) || r.application_number.toLowerCase().includes(q) || r.county.toLowerCase().includes(q))
      && filterFn(r, f));
    return sortFn ? [...out].sort(sortFn) : out;
  }, [data, county, f, filterFn, sortFn]);
  return { data, isLoading, error, rows, f, setF };
}

function FilterBar({ f, setF, count, total, children }: { f: Filters; setF: (f: Filters) => void; count: number; total: number; children?: ReactNode }) {
  const dirty = f.q || f.a || f.b;
  return (
    <div className="filters ev-filters">
      <label className="filter-search">
        <Search size={15} />
        <input aria-label="Search clusters" placeholder="Search cluster, application ID or county..." value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
      </label>
      {children}
      {dirty && <Button variant="ghost" size="icon" title="Clear filters" aria-label="Clear filters" onClick={() => setF({ q: '', a: '', b: '' })}><RotateCcw /></Button>}
      <span className="ev-count">{count === total ? `${total} clusters` : `${count} of ${total} clusters`}</span>
    </div>
  );
}

function RowActions({ r, onSelect }: { r: EvalRow; onSelect: (a: string) => void }) {
  return (
    <div className="ev-actions-cell">
      <ReportButton applicationNumber={r.application_number} clusterName={r.cluster_name} />
      <Button variant="ghost" size="sm" className="profile-link" aria-label={`View profile of ${r.cluster_name}`} title="Open the full cluster profile" onClick={() => onSelect(r.application_number)}>
        View profile<ArrowUpRight />
      </Button>
    </div>
  );
}

function ClusterCell({ r, open, toggle, label }: { r: EvalRow; open: boolean; toggle: () => void; label: string }) {
  return (
    <>
      <div className="cluster-name">
        {r.cluster_name}
        <span className="cluster-id">{r.application_number}</span>
      </div>
      <div className="gr-sub">{r.county} · {chain(r.value_chain)}</div>
      <button type="button" className="gr-toggle" aria-expanded={open} onClick={toggle}>
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}{open ? 'Hide details' : label}
      </button>
    </>
  );
}

function Empty() {
  return <div className="empty-state"><SearchX size={28} /><p>No clusters match these filters.</p></div>;
}

/** The three amounts of an application in one labelled list. */
function FigureList({ title, grant, total, cash, compare }: {
  title: string; grant: number | null; total: number | null; cash: number | null;
  compare?: { grant: number | null; total: number | null; cash: number | null };
}) {
  const differs = (a: number | null, b: number | null | undefined) => compare != null && (a ?? null) !== (b ?? null) && Math.abs((a ?? 0) - (b ?? 0)) > 1;
  const rows: Array<[string, number | null, boolean]> = [
    ['Matching grant requested', grant, differs(grant, compare?.grant)],
    ['Total project cost', total, differs(total, compare?.total)],
    ['Cluster cash contribution', cash, differs(cash, compare?.cash)],
  ];
  return (
    <dl className={`fig-list ${compare ? 'fig-current' : ''}`}>
      <dt className="fig-title">{title}</dt><dd className="fig-title" />
      {rows.map(([label, value, changed]) => (
        <Fragment key={label}>
          <dt>{label}</dt>
          <dd className={changed ? 'fig-changed' : undefined}>{kes(value)}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

// ── Financial screening ───────────────────────────────────────

const FIN_RESULTS = ['PASS', 'FOLLOW-UP: data error', 'FOLLOW-UP: documents', 'FOLLOW-UP: exceeds cap', 'NON-COMPLIANT: <50% cash'];

export function FinancialScreeningPage({ onSelect }: { onSelect: (a: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const { isLoading, error, rows, f, setF, data } = useRows(
    (r, fl) => (!fl.a || r.financial.result === fl.a) && (!fl.b || r.financial.category === fl.b),
    (a, b) => (b.financial.contribution_shortfall ?? 0) - (a.financial.contribution_shortfall ?? 0),
  );
  if (isLoading) return <Loading />;
  if (error || !data) return <Failed />;
  return (
    <>
      <CountyFilter shown={rows.length} />
      <div className="chart-panel">
        <div className="panel-header">
          <div><h2>Financial screening</h2><p>The 50/50 matching rule and Window 1 and Window 2 limits, worked out from the application amounts as evaluated. Largest cash shortfall first.</p></div>
        </div>
        <FilterBar f={f} setF={setF} count={rows.length} total={data.data.length}>
          <select className="filter-select" aria-label="Filter by result" value={f.a} onChange={(e) => setF({ ...f, a: e.target.value })}>
            <option value="">All results</option>{FIN_RESULTS.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <select className="filter-select" aria-label="Filter by category" value={f.b} onChange={(e) => setF({ ...f, b: e.target.value })}>
            <option value="">All windows</option>
            {['Window 1 (Growth Window)', 'Window 2 (Transformational Window)', 'Above the Window 2 ceiling', 'Invalid grant (zero or less)'].map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </FilterBar>
        {rows.length === 0 ? <Empty /> : (
          <div className="fit-wrap">
            <table className="portfolio-table fit-table">
              <colgroup><col style={{ width: '19%' }} /><col style={{ width: '11%' }} /><col style={{ width: '26%' }} /><col style={{ width: '11%' }} /><col /><col style={{ width: 176 }} /></colgroup>
              <thead><tr><th>Cluster</th><th>Window</th><th>Figures</th><th>Cluster cash share</th><th>Result</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const isOpen = open === r.application_number;
                  const fin = r.financial;
                  return (
                    <Fragment key={r.application_number}>
                      <tr>
                        <td><ClusterCell r={r} open={isOpen} toggle={() => setOpen(isOpen ? null : r.application_number)} label="Show the checks" /></td>
                        <td className="win-cell">{fin.category.split(' (')[0]}{fin.category.includes(' (') && <small>{fin.category.split(' (')[1]?.replace(')', '')}</small>}</td>
                        <td>
                          <FigureList title="Application figures (as evaluated)" grant={fin.grant} total={fin.total} cash={fin.contribution} />
                        </td>
                        <td>
                          <strong className={fin.meets_50_percent_cash === false ? 'ev-bad' : undefined}>{pct(fin.cluster_share)}</strong>
                          {fin.contribution_shortfall ? <span className="gr-sub">short by {kes(fin.contribution_shortfall)}</span> : <span className="gr-sub">meets the 50% minimum</span>}
                        </td>
                        <td>
                          <StatusChip value={fin.result} />
                          {fin.issues[0] && <span className="gr-sub">{fin.issues[0]}{fin.issues.length > 1 ? ` (+${fin.issues.length - 1} more)` : ''}</span>}
                        </td>
                        <td><RowActions r={r} onSelect={onSelect} /></td>
                      </tr>
                      {isOpen && <tr className="gr-why"><td colSpan={6}><WithDetail applicationNumber={r.application_number}>{(d) => <FinancialPanel d={d} />}</WithDetail></td></tr>}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ── Eligibility ───────────────────────────────────────────────

export function EligibilityPage({ onSelect }: { onSelect: (a: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const { isLoading, error, rows, f, setF, data } = useRows(
    (r, fl) => (!fl.a || r.eligibility === fl.a) && (!fl.b || (r.tests[fl.b] != null && gateTone(r.tests[fl.b]) !== 'good')),
    (a, b) => (b.score ?? 0) - (a.score ?? 0),
  );
  if (isLoading) return <Loading />;
  if (error || !data) return <Failed />;
  const counts = (s: string) => data.data.filter((r) => r.eligibility === s).length;
  return (
    <>
      <CountyFilter shown={rows.length} />
      <div className="chart-panel">
        <div className="panel-header">
          <div>
            <h2>Eligibility</h2>
            <p>{counts('PASS')} pass, {counts('HOLD')} on hold, {counts('FAIL')} fail. Each chip is one of the ten tests (E1 to E10): select a cluster's details to read the reasons.</p>
          </div>
        </div>
        <FilterBar f={f} setF={setF} count={rows.length} total={data.data.length}>
          <select className="filter-select" aria-label="Filter by status" value={f.a} onChange={(e) => setF({ ...f, a: e.target.value })}>
            <option value="">All statuses</option>{['PASS', 'HOLD', 'FAIL'].map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <select className="filter-select" aria-label="Filter by test needing attention" value={f.b} onChange={(e) => setF({ ...f, b: e.target.value })}>
            <option value="">Any test</option>
            {Array.from({ length: 10 }, (_, i) => `E${i + 1}`).map((t) => <option key={t} value={t}>{t} on hold or failed</option>)}
          </select>
        </FilterBar>
        {rows.length === 0 ? <Empty /> : (
          <div className="fit-wrap">
            <table className="portfolio-table fit-table">
              <colgroup><col style={{ width: '26%' }} /><col style={{ width: '16%' }} /><col /><col style={{ width: '12%' }} /><col style={{ width: 176 }} /></colgroup>
              <thead><tr><th>Cluster</th><th>Eligibility</th><th>Tests E1 to E10</th><th>Score</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const isOpen = open === r.application_number;
                  const weak = Object.entries(r.tests).filter(([, d]) => d != null && gateTone(d) !== 'good').map(([t]) => t);
                  return (
                    <Fragment key={r.application_number}>
                      <tr>
                        <td><ClusterCell r={r} open={isOpen} toggle={() => setOpen(isOpen ? null : r.application_number)} label="Why this status" /></td>
                        <td><StatusChip value={r.eligibility} />{weak.length > 0 && <span className="gr-sub">attention: {weak.join(', ')}</span>}</td>
                        <td><TestChips tests={r.tests} /></td>
                        <td><ScoreBar score={r.score} compact /></td>
                        <td><RowActions r={r} onSelect={onSelect} /></td>
                      </tr>
                      {isOpen && <tr className="gr-why"><td colSpan={5}><WithDetail applicationNumber={r.application_number}>{(d) => <EligibilityPanel d={d} />}</WithDetail></td></tr>}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ── Scorecard ─────────────────────────────────────────────────

export function ScorecardPage({ onSelect }: { onSelect: (a: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const { isLoading, error, rows, f, setF, data } = useRows(
    (r, fl) => (!fl.a || r.band === fl.a) && (!fl.b || r.eligibility === fl.b),
    (a, b) => (b.score ?? -1) - (a.score ?? -1),
  );
  if (isLoading) return <Loading />;
  if (error || !data) return <Failed />;
  return (
    <>
      <CountyFilter shown={rows.length} />
      <div className="chart-panel">
        <div className="panel-header">
          <div><h2>Scoring</h2><p>Six weighted criteria add up to 100 points. 70 or more is Recommended, 50 to 69 Referred with comments, below 50 Rejected. Highest score first.</p></div>
        </div>
        <FilterBar f={f} setF={setF} count={rows.length} total={data.data.length}>
          <select className="filter-select" aria-label="Filter by band" value={f.a} onChange={(e) => setF({ ...f, a: e.target.value })}>
            <option value="">All bands</option>{['Recommended', 'Referred with Comments', 'Rejected'].map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <select className="filter-select" aria-label="Filter by eligibility" value={f.b} onChange={(e) => setF({ ...f, b: e.target.value })}>
            <option value="">Any eligibility</option>{['PASS', 'HOLD', 'FAIL'].map((v) => <option key={v} value={v}>Eligibility {v}</option>)}
          </select>
        </FilterBar>
        {rows.length === 0 ? <Empty /> : (
          <div className="fit-wrap">
            <table className="portfolio-table fit-table">
              <colgroup><col style={{ width: '21%' }} /><col /><col style={{ width: '11%' }} /><col style={{ width: '15%' }} /><col style={{ width: 176 }} /></colgroup>
              <thead><tr><th>Cluster</th><th>Criteria (points earned / weight)</th><th>Total score</th><th>Band</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const isOpen = open === r.application_number;
                  return (
                    <Fragment key={r.application_number}>
                      <tr>
                        <td>
                          <ClusterCell r={r} open={isOpen} toggle={() => setOpen(isOpen ? null : r.application_number)} label="Show the ratings" />
                        </td>
                        <td>
                          <div className="crit-grid">
                            {r.criteria.map((k) => (
                              <div key={k.code} title={`${k.code}: rated ${k.rating ?? 'n/a'} of 5`}>
                                <span>{k.code}</span>
                                <strong>{k.score ?? '-'}<small>/{k.weight}</small></strong>
                                <span className="score-track"><i className={`tone-${k.score == null ? 'neutral' : k.score / k.weight >= 0.7 ? 'good' : k.score / k.weight >= 0.5 ? 'warn' : 'bad'}`} style={{ width: `${k.score ? (k.score / k.weight) * 100 : 0}%` }} /></span>
                              </div>
                            ))}
                          </div>
                        </td>
                        <td><ScoreBar score={r.score} compact />{r.rank != null && <span className="gr-sub">#{r.rank} among eligible</span>}</td>
                        <td>
                          <BandChip band={r.band} score={r.score} />
                        </td>
                        <td><RowActions r={r} onSelect={onSelect} /></td>
                      </tr>
                      {isOpen && <tr className="gr-why"><td colSpan={5}><WithDetail applicationNumber={r.application_number}>{(d) => <ScorePanel d={d} />}</WithDetail></td></tr>}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

