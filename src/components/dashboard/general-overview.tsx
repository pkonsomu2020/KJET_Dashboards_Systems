import { useMemo, useState, type ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Award, Banknote, BriefcaseBusiness, Building2, Handshake, Info, Loader2, MapPin, Trophy, Users } from 'lucide-react';
import { money, number, percent } from '@/data/portfolio';
import { useByChain, useEvaluationList, useEvaluationOverview, useFinalists, usePortfolioSummary } from '@/hooks/usePortfolio';
import { Stat } from './finalists-pages';

const tooltipStyle = { background: 'var(--card)', borderColor: 'var(--border)', borderRadius: 6, fontSize: 11, color: 'var(--foreground)' };
const PILL_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--success)', 'var(--warning)', 'var(--muted-foreground)'];
/** Same reading as the evaluation pages: 70 or more is strong, 50 to 69 middle, below 50 weak. */
const scoreColor = (lo: number) => (lo >= 70 ? 'var(--success)' : lo >= 50 ? 'var(--chart-1)' : 'var(--danger)');

function Panel({ title, subtitle, footer, children }: { title: string; subtitle: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <section className="chart-panel">
      <div className="panel-header"><div><h2>{title}</h2><p>{subtitle}</p></div></div>
      <div className="panel-body">{children}</div>
      {footer && <div className="chart-footer">{footer}</div>}
    </section>
  );
}

/** Horizontal pills: the length is the count against the largest, the count sits at the end of the pill, the share follows. */
export function PillBars({ items, total, unit }: { items: Array<{ name: string; value: number; note?: string }>; total: number; unit: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="go-pills" aria-label={items.map((i) => `${i.name}: ${i.value}`).join('; ')}>
      {items.map((i, idx) => (
        <li key={i.name} title={i.note ?? `${i.name}: ${i.value} ${unit}`}>
          <span className="go-pill-label">{i.name}</span>
          <span className="go-pill-track">
            <span className="go-pill" style={{ width: `${Math.max(7, (i.value / max) * 100)}%`, background: PILL_COLORS[idx % PILL_COLORS.length] }}><b>{number(i.value)}</b></span>
          </span>
          <span className="go-pill-share">{total ? percent(i.value, total).toFixed(1) : '0.0'}%</span>
        </li>
      ))}
    </ul>
  );
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * The home page: Cohort 1 only, from its 90 finalists to the co-investment evaluation of its 85 clusters.
 * Cohort 2 is added once its field work and corrections are finished.
 */
export function GeneralOverview() {
  const summary = usePortfolioSummary();
  const chains = useByChain();
  const evalOverview = useEvaluationOverview();
  const evalList = useEvaluationList();
  const finalists = useFinalists(1);
  const [pickedCounty, setPickedCounty] = useState('');

  const s = summary.data;
  const ov = evalOverview.data;
  const evaluated = evalList.data?.data ?? [];
  const finalistRows = finalists.data?.data ?? [];

  const view = useMemo(() => {
    const funnel = (ov?.funnel ?? []).map((f) => ({ name: f.stage, value: f.count }));
    const stages = [{ name: 'Cohort 1 finalists', value: finalistRows.length }, ...funnel.map((f) => (f.name === 'Evaluated' ? { ...f, name: 'Evaluated for co-investment' } : f))];

    const scoreBuckets = (ov?.score_distribution ?? []).map((b, i) => ({ name: b.label, value: b.count, lo: i * 10 }));
    const firstFilled = Math.max(0, scoreBuckets.findIndex((b) => b.value > 0));
    const evalScores = scoreBuckets.slice(firstFilled);

    const bins = [[40, 49], [50, 59], [60, 69], [70, 79], [80, 89], [90, 100]] as const;
    const finalistScores = bins.map(([lo, hi]) => ({ name: hi === 100 ? '90 to 100' : `${lo} to ${hi}`, value: finalistRows.filter((r) => r.composite != null && r.composite >= lo && r.composite <= hi).length, lo }));
    const tier1 = finalistRows.filter((r) => r.tier === 'Tier 1').length;
    const tier2 = finalistRows.filter((r) => r.tier === 'Tier 2').length;

    const topCounties = [...(ov?.counties ?? [])].sort((a, b) => b.count - a.count || (b.average_score ?? 0) - (a.average_score ?? 0)).slice(0, 10)
      .map((c) => ({ name: c.name.length > 13 ? `${c.name.slice(0, 12)}…` : c.name, full: c.name, Clusters: c.count, 'Average score': c.average_score }));

    const countyNames = [...new Set(evaluated.map((e) => e.county))].sort((a, b) => a.localeCompare(b));
    return { stages, evalScores, finalistScores, tier1, tier2, topCounties, countyNames };
  }, [ov, evaluated, finalistRows]);

  const loading = summary.isLoading || chains.isLoading || evalOverview.isLoading || evalList.isLoading || finalists.isLoading;
  if (loading) return <div className="chart-panel" style={{ minHeight: 240, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Loader2 size={26} className="animate-spin text-muted-foreground" /></div>;
  if (!s || !ov || !finalists.data) return <div className="notice"><Info size={16} /><span>The overview could not be loaded. Please refresh the page.</span></div>;

  const countyCount = new Set(finalistRows.map((r) => r.county)).size;
  const cost = Number(s.cost), grant = Number(s.grant), contribution = Number(s.contribution), members = Number(s.members);
  const chainList = [...(chains.data ?? [])].sort((a, b) => Number(b.count) - Number(a.count));
  const chainTotal = chainList.reduce((t, c) => t + Number(c.count), 0);
  const strong = ov.funnel.find((f) => f.stage === 'Score 70 or more')?.count ?? 0;

  // County analysis: the clusters evaluated in the chosen county, and its two finalists
  const county = pickedCounty || (view.topCounties[0]?.full ?? view.countyNames[0] ?? '');
  const inCounty = evaluated.filter((e) => e.county === county);
  const scored = inCounty.map((e) => e.score).filter((v): v is number => v != null);
  const sum = (xs: Array<number | null>) => xs.reduce<number>((t, v) => t + (v ?? 0), 0);
  const countyCost = sum(inCounty.map((e) => e.financial.total));
  const countyGrant = sum(inCounty.map((e) => e.financial.grant));
  const countyClusters = [...inCounty].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const countyAvg = avg(scored);

  return (
    <>
      <div className="metrics-grid go-tiles">
        <Stat label="Cohort 1 finalists" value={number(finalistRows.length)} icon={Trophy}>
          <span className="badge success"><MapPin size={10} />{countyCount} counties</span><span>Two in each county</span>
        </Stat>
        <Stat label="Evaluated for co-investment" value={number(ov.funnel[0]?.count ?? 0)} icon={Building2}>
          <span className="badge success">{number(strong)} scored 70 or more</span>
        </Stat>
        <Stat label="Average evaluation score" value={ov.average_score == null ? '-' : ov.average_score.toFixed(1)} icon={Award}>
          <span>Out of 100, across the evaluated clusters</span>
        </Stat>
        <Stat label="Total project cost" value={money(cost)} icon={Banknote}>
          <span>Costs the {number(Number(s.count))} applications state, added together</span>
        </Stat>
        <Stat label="Matching grant requested" value={money(grant)} icon={Handshake}>
          <span className="badge">{percent(grant, cost).toFixed(1)}% of cost</span><span>Requested, not disbursed</span>
        </Stat>
        <Stat label="Cluster cash contribution" value={money(contribution)} icon={Banknote}>
          <span className="badge success">{percent(contribution, cost).toFixed(1)}% of cost</span>
        </Stat>
        <Stat label="Members represented" value={number(members)} icon={Users}>
          <span className="badge">{number(Number(s.women))} women ({percent(Number(s.women), members).toFixed(1)}%)</span>
          <span className="badge success">{number(Number(s.youth))} youth ({percent(Number(s.youth), members).toFixed(1)}%)</span>
        </Stat>
        <Stat label="Jobs after investment (Year 3)" value={number(Number(s.jobs_year3))} icon={BriefcaseBusiness}>
          <span>Applicant-reported</span>
        </Stat>
      </div>

      <div className="fn-grid2">
        <Panel title="From finalists to co-investment" subtitle="How many of the 90 finalists went through each step of the evaluation"
          footer={<><span>Finalists evaluated</span><strong className="text-foreground">{number(ov.funnel[0]?.count ?? 0)} of {number(finalistRows.length)}</strong></>}>
          <PillBars items={view.stages} total={finalistRows.length} unit="clusters" />
        </Panel>

        <Panel title="How the finalists scored" subtitle="Selection score of the 90 finalists, in bands of ten points"
          footer={<><span>Tier 1 and Tier 2</span><strong className="text-foreground">{view.tier1} and {view.tier2}</strong></>}>
          <div className="chart-box" style={{ height: 270 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={view.finalistScores} margin={{ top: 12, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 4" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} dy={6} />
                <YAxis axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip formatter={(v) => [number(Number(v)), 'Finalists']} contentStyle={tooltipStyle} cursor={{ fill: 'var(--muted)' }} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={44}>
                  {view.finalistScores.map((b) => <Cell key={b.name} fill={scoreColor(b.lo)} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <div className="fn-grid2">
        <Panel title="Value chains" subtitle="The 85 evaluated clusters by value chain" footer={<><span>Value chains represented</span><strong className="text-foreground">{chainList.length}</strong></>}>
          <PillBars unit="clusters" total={chainTotal}
            items={chainList.map((c) => ({ name: c.name, value: Number(c.count), note: `${c.name}: ${c.count} clusters, grant requested ${money(Number(c.grant))}` }))} />
        </Panel>

        <Panel title="Evaluation score distribution" subtitle="Co-investment evaluation score of the evaluated clusters, in bands of ten points"
          footer={<><span><i className="go-key" style={{ background: 'var(--success)' }} />70 or more <i className="go-key" style={{ background: 'var(--chart-1)' }} />50 to 69 <i className="go-key" style={{ background: 'var(--danger)' }} />below 50</span></>}>
          <div className="chart-box" style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={view.evalScores} margin={{ top: 12, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 4" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} dy={6} />
                <YAxis axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip formatter={(v) => [number(Number(v)), 'Clusters']} contentStyle={tooltipStyle} cursor={{ fill: 'var(--muted)' }} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={44}>
                  {view.evalScores.map((b) => <Cell key={b.name} fill={scoreColor(b.lo)} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <div className="fn-grid2">
        <Panel title="Top counties" subtitle="The ten counties with the most evaluated clusters, and their average score">
          <div className="chart-box" style={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={view.topCounties} margin={{ top: 12, right: 6, left: -8, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 4" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} interval={0} angle={-35} textAnchor="end" height={64} tick={{ fontSize: 10 }} />
                <YAxis yAxisId="n" axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis yAxisId="s" orientation="right" domain={[0, 100]} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--muted)' }} labelFormatter={(_l, p) => String((p?.[0]?.payload as { full?: string } | undefined)?.full ?? '')} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="n" dataKey="Clusters" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={30} />
                <Line yAxisId="s" type="monotone" dataKey="Average score" stroke="var(--danger)" strokeWidth={2.5} dot={{ r: 4, fill: 'var(--danger)', stroke: 'var(--card)', strokeWidth: 2 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="County analysis" subtitle="Co-investment evaluation by county">
          <label className="go-county">
            <span className="sr-only">County</span>
            <select className="filter-select go-select" value={county} onChange={(e) => setPickedCounty(e.target.value)} aria-label="County">
              {view.countyNames.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <div className="go-mini">
            <div><small>Clusters</small><strong>{inCounty.length}</strong></div>
            <div><small>Average score</small><strong>{countyAvg == null ? '-' : countyAvg.toFixed(1)}</strong></div>
            <div><small>Top score</small><strong>{scored.length ? Math.max(...scored).toFixed(1) : '-'}</strong></div>
          </div>
          <div className="go-mini go-mini2">
            <div><small>Project cost</small><strong>{money(countyCost)}</strong></div>
            <div><small>Grant requested</small><strong>{money(countyGrant)}</strong></div>
          </div>
          <table className="go-table">
            <thead><tr><th>Cluster</th><th>Value chain</th><th>Score</th></tr></thead>
            <tbody>
              {countyClusters.map((e) => (
                <tr key={e.application_number}><td>{e.cluster_name}</td><td>{e.value_chain}</td><td>{e.score == null ? '-' : e.score.toFixed(1)}</td></tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </>
  );
}
