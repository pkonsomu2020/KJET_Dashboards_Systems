import { useMemo, type ReactNode } from 'react';
import { BarChart, Bar, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Info, MapPin, Repeat, Trophy, FileText, Users, Layers3, TriangleAlert } from 'lucide-react';
import { number } from '@/data/portfolio';
import { useFinalists } from '@/hooks/usePortfolio';
import { Stat, isCohort1Alternate } from './finalists-pages';
import { PillBars } from './general-overview';
import { PageLoader } from './motion';

const tooltipStyle = { background: 'var(--card)', borderColor: 'var(--border)', borderRadius: 6, fontSize: 11, color: 'var(--foreground)' };
const COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--muted-foreground)'];

function Panel({ title, subtitle, footer, children }: { title: string; subtitle: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <section className="chart-panel">
      <div className="panel-header"><div><h2>{title}</h2><p>{subtitle}</p></div></div>
      <div className="panel-body">{children}</div>
      {footer && <div className="chart-footer">{footer}</div>}
    </section>
  );
}

const count = <T,>(xs: T[], key: (x: T) => string) => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
  return [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
};

/**
 * The Cohort 2 finalists at a glance. Everything here is read from the Cohort 2 spreadsheet (the Selected tab) and from the
 * application forms in the finalists' folders; the form figures are what the clusters stated, and only forms that really are the
 * finalist's own are counted.
 */
export function Cohort2Overview() {
  const { data, isLoading, error } = useFinalists(2);
  const rows = data?.data ?? [];

  const view = useMemo(() => {
    const chains = count(rows, (r) => r.value_chain ?? 'Not given').map((c) => ({ ...c, name: c.name.replace(/_/g, ' ') }));
    const bins = [[30, 39], [40, 49], [50, 59], [60, 69], [70, 79], [80, 89], [90, 100]] as const;
    const spread = bins.map(([lo, hi]) => ({ name: lo === 90 ? '90 to 100' : `${lo} to ${hi}`, value: rows.filter((r) => r.composite != null && r.composite >= lo && r.composite <= hi).length }));
    const tiers = count(rows, (r) => r.tier ?? 'No tier').sort((a, b) => a.name.localeCompare(b.name));
    const byCounty = new Map<string, number[]>();
    for (const r of rows) if (r.composite != null) byCounty.set(r.county, [...(byCounty.get(r.county) ?? []), r.composite]);
    const counties = [...byCounty.entries()].map(([name, xs]) => ({ name, value: Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 })).sort((a, b) => b.value - a.value);
    const withForm = rows.filter((r) => r.form);
    const years = ['2022', '2023', '2024'];
    const stated = years.map((y) => ({ name: y, Members: withForm.reduce((s, r) => s + (r.form?.members[y] ?? 0), 0), Employees: withForm.reduce((s, r) => s + (r.form?.employees[y] ?? 0), 0) }));
    // gender and age of the members, as the latest year of each form states them
    const latest = withForm.map((r) => {
      const d = r.form?.demographics; const y = d ? Object.keys(d).filter((k) => d[k] && (d[k].females != null || d[k].males != null)).sort().pop() : undefined;
      return y && d ? d[y] : r.form;
    }).filter((x): x is NonNullable<typeof x> => x != null);
    const tot = (k: 'females' | 'males' | 'age_18_35' | 'age_36_50' | 'age_over_50') => latest.reduce((t, x) => t + (x[k] ?? 0), 0);
    const gender = [{ name: 'Women', value: tot('females') }, { name: 'Men', value: tot('males') }];
    const age = [{ name: 'Aged 18 to 35', value: tot('age_18_35') }, { name: 'Aged 36 to 50', value: tot('age_36_50') }, { name: 'Over 50', value: tot('age_over_50') }];
    const e4 = [
      { name: 'Note says yes', value: rows.filter((r) => /^\s*yes\b/i.test(r.checks.e4 ?? '')).length },
      { name: 'Note says no', value: rows.filter((r) => /^\s*no\b/i.test(r.checks.e4 ?? '')).length },
      { name: 'No yes or no in the note', value: rows.filter((r) => !/^\s*(yes|no)\b/i.test(r.checks.e4 ?? '')).length },
    ];
    const avg = rows.filter((r) => r.composite != null);
    return {
      chains, spread, tiers, counties, withForm: withForm.length, stated, e4, gender, age,
      average: avg.length ? avg.reduce((s, r) => s + (r.composite ?? 0), 0) / avg.length : null,
      alternates: rows.filter(isCohort1Alternate).length,
      folderOther: rows.filter((r) => r.form_status === 'wrong_application').length,
      linkHidden: rows.filter((r) => !r.drive_link).length,
      blankTier: rows.filter((r) => r.flags.some((f) => /tier is blank/.test(f))).length,
      missingFiles: rows.filter((r) => (r.missing_files?.length ?? 0) > 0).length,
    };
  }, [rows]);

  if (isLoading) return <PageLoader label="Loading the Cohort 2 overview" />;
  if (error || !data) return <div className="notice"><Info size={16} /><span>The Cohort 2 finalists could not be loaded. Please refresh the page.</span></div>;

  const counties = new Set(rows.map((r) => r.county)).size;
  const tier1 = view.tiers.find((t) => t.name === 'Tier 1')?.value ?? 0;
  const tier2 = view.tiers.find((t) => t.name === 'Tier 2')?.value ?? 0;
  const topCounties = view.counties.slice(0, 10).map((c) => ({ ...c, name: c.name.length > 16 ? `${c.name.slice(0, 15)}…` : c.name }));

  return (
    <>
      <div className="metrics-grid">
        <Stat label="Finalists" value={number(rows.length)} icon={Trophy}>
          <span className="badge success"><MapPin size={10} />{counties} counties</span><span>Top 6 in each county</span>
        </Stat>
        <Stat label="Average composite score" value={view.average == null ? '-' : view.average.toFixed(1)} icon={Trophy}>
          <span>Weighted scores, equity points less penalties</span>
        </Stat>
        <Stat label="Tier 1 and Tier 2" value={`${tier1} / ${tier2}`} icon={Layers3}>
          <span>Integrated clusters / less integrated clusters</span>
        </Stat>
        <Stat label="Cohort 1 alternates" value={number(view.alternates)} icon={Repeat}>
          <span>Carried over from Cohort 1; their Application IDs are Cohort 1 numbers</span>
        </Stat>
        <Stat label="Application forms read" value={`${view.withForm} of ${rows.length}`} icon={FileText}>
          <span>{view.folderOther ? `${view.folderOther} folders hold another cluster's application` : 'Every folder holds its own finalist\'s application'}</span>
        </Stat>
      </div>

      <div className="fn-grid2">
        <Panel title="Finalists by value chain" subtitle="The priority value chain recorded for each finalist (E3)" footer={<><span>Value chains represented</span><strong className="text-foreground">{view.chains.length}</strong></>}>
          <div className="chart-box" style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={view.chains} layout="vertical" margin={{ top: 4, right: 18, left: 4, bottom: 0 }}>
                <CartesianGrid horizontal={false} strokeDasharray="3 4" />
                <XAxis type="number" axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} width={132} />
                <Tooltip formatter={(v) => [number(Number(v)), 'Finalists']} contentStyle={tooltipStyle} cursor={{ fill: 'var(--muted)' }} />
                <Bar dataKey="value" fill="var(--chart-1)" radius={[0, 3, 3, 0]} maxBarSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="How the finalists scored" subtitle="Composite score, in bands of ten points" footer={<><span>Highest and lowest score</span><strong className="text-foreground">{rows.length ? `${Math.max(...rows.map((r) => r.composite ?? 0))} and ${Math.min(...rows.filter((r) => r.composite != null).map((r) => r.composite as number))}` : '-'}</strong></>}>
          <div className="chart-box" style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={view.spread} margin={{ top: 12, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 4" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} dy={6} />
                <YAxis axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip formatter={(v) => [number(Number(v)), 'Finalists']} contentStyle={tooltipStyle} cursor={{ fill: 'var(--muted)' }} />
                <Bar dataKey="value" fill="var(--chart-2)" radius={[3, 3, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <div className="fn-grid2">
        <Panel title="Highest-scoring counties" subtitle="Average composite score of each county's six finalists · top 10">
          <div className="chart-box" style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topCounties} layout="vertical" margin={{ top: 4, right: 18, left: 4, bottom: 0 }}>
                <CartesianGrid horizontal={false} strokeDasharray="3 4" />
                <XAxis type="number" domain={[0, 100]} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} width={104} />
                <Tooltip formatter={(v) => [Number(v).toFixed(1), 'Average score']} contentStyle={tooltipStyle} cursor={{ fill: 'var(--muted)' }} />
                <Bar dataKey="value" fill="var(--chart-3)" radius={[0, 3, 3, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Tiers" subtitle="Tier 1 clusters work as integrated businesses; Tier 2 member MSMEs operate more independently">
          <div className="donut-layout">
            <div className="donut-box">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={view.tiers} dataKey="value" innerRadius="64%" outerRadius="88%" paddingAngle={3} stroke="none">
                    {view.tiers.map((t, i) => <Cell key={t.name} fill={COLORS[i]} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
              <div className="donut-center"><strong>{rows.length}</strong><span>Finalists</span></div>
            </div>
            <div className="sector-legend">
              {view.tiers.map((t, i) => (
                <div className="sector-row" key={t.name}><i className="sector-swatch" style={{ background: COLORS[i] }} /><span>{t.name}</span><strong>{t.value}</strong></div>
              ))}
            </div>
          </div>
          <div className="fn-split">
            <strong>Financial evidence (E4)</strong>
            <p>What the evaluator's note says about the financial evidence each finalist supplied.</p>
            {view.e4.map((e) => <div className="ev-row" key={e.name}><span>{e.name}</span><strong className={e.name === 'Note says no' && e.value ? 'ev-warn' : ''}>{e.value}</strong></div>)}
          </div>
        </Panel>
      </div>

      <div className="fn-grid2">
        <Panel title="Members and employees, as the clusters stated them" subtitle={`Added up over the ${view.withForm} application forms that are the finalist's own`}>
          <div className="chart-box" style={{ height: 270 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={view.stated} barCategoryGap="24%" margin={{ top: 12, right: 8, left: 4, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 4" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} />
                <YAxis axisLine={false} tickLine={false} tickFormatter={(v) => number(v)} />
                <Tooltip formatter={(v, name) => [number(Number(v)), name]} contentStyle={tooltipStyle} cursor={{ fill: 'var(--muted)' }} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Members" fill="var(--chart-1)" radius={[3, 3, 0, 0]} maxBarSize={36} />
                <Bar dataKey="Employees" fill="var(--chart-2)" radius={[3, 3, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Who the clusters represent" subtitle="Gender and age of the members, as the clusters stated them">
          <p className="go-sub">Gender</p>
          <PillBars items={view.gender} total={view.gender.reduce((t, g) => t + g.value, 0)} unit="members" />
          <p className="go-sub">Age</p>
          <PillBars items={view.age} total={view.age.reduce((t, g) => t + g.value, 0)} unit="members" />
        </Panel>
      </div>
    </>
  );
}
