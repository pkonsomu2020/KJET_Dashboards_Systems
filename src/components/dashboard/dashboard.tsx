import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  LayoutDashboard, Building2, ShieldCheck, Download, ChevronRight,
  Search, Moon, Sun, Menu, X, Layers3, BriefcaseBusiness, CircleDollarSign,
  Handshake, TrendingUp, CalendarDays, AlertTriangle, Globe2,
  MapPin, Users, Wallet, Loader2, LogOut, Award, ArrowUpRight,
} from 'lucide-react';
import {
  BarChart, Bar, CartesianGrid, XAxis, YAxis, ResponsiveContainer,
  Tooltip, PieChart, Pie, Cell,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { money, number, percent, exportCSV } from '@/data/portfolio';
import {
  usePortfolioSummary, useByChain, useByCounty, useEvaluation,
} from '@/hooks/usePortfolio';
import { useSession, useSignOut } from '@/hooks/useAuth';
import type { ClusterRow } from '@/data/api';
import { ClusterExplorer } from './explorer';
import { ClusterProfile } from './profile';
import { AssistantPanel } from './assistant';
import { GrantReady } from './grant-ready';
import { BandChip, ScoreBar } from './evaluation-ui';

export type DashboardView = 'overview' | 'clusters' | 'grant-ready';

const nav = [
  { to: '/',         label: 'Overview',        icon: LayoutDashboard, view: 'overview' },
  { to: '/clusters', label: 'Cluster explorer', icon: Building2,       view: 'clusters' },
  { to: '/grant-ready', label: 'Grant-ready clusters', icon: Award,      view: 'grant-ready' },
] as const;

const titles: Record<DashboardView, [string, string]> = {
  overview: ['Portfolio overview', 'Cohort 1 co-investment matching grants & business development services'],
  clusters: ['Cluster explorer',   '85 beneficiary clusters — search, filter and inspect every application'],
  'grant-ready': ['Grant-ready clusters', 'Clusters recommended for grant support after scoring and eligibility screening'],
};

const CHART_COLORS = [
  'var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)',
  'var(--chart-4)', 'var(--chart-5)', 'var(--muted-foreground)',
];
const tooltipStyle = {
  background: 'var(--card)', borderColor: 'var(--border)',
  borderRadius: 6, fontSize: 11, color: 'var(--foreground)',
};

function Metric({ label, value, icon: Icon, children, loading }: {
  label: string; value: string; icon: typeof Users;
  children: ReactNode; loading?: boolean;
}) {
  return (
    <article className="metric">
      <div className="metric-label"><span>{label}</span><Icon /></div>
      <div className="metric-value">
        {loading ? <Loader2 size={20} className="animate-spin text-muted-foreground" /> : value}
      </div>
      <div className="metric-foot">{children}</div>
    </article>
  );
}

function ChartPanel({ title, subtitle, children, footer, legend }: {
  title: string; subtitle: string; children: ReactNode; footer?: ReactNode; legend?: ReactNode;
}) {
  return (
    <section className="chart-panel">
      <div className="panel-header">
        <div><h2>{title}</h2><p>{subtitle}</p></div>
        {legend}
      </div>
      <div className="panel-body">{children}</div>
      {footer && <div className="chart-footer">{footer}</div>}
    </section>
  );
}

function LoadingPanel() {
  return (
    <div className="chart-panel" style={{ minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Loader2 size={24} className="animate-spin text-muted-foreground" />
    </div>
  );
}

export function Dashboard({ view = 'overview' }: { view?: DashboardView }) {
  const [dark, setDark] = useState(false);
  const [menu, setMenu] = useState(false);
  const [query, setQuery] = useState('');
  const [county, setCounty] = useState('');
  const [chain, setChain] = useState('');
  const [sort, setSort] = useState('name');
  const [shortlist, setShortlist] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exportRows, setExportRows] = useState<ClusterRow[]>([]);
  const [time, setTime] = useState('');

  const navigate  = useNavigate();
  const { data: session } = useSession();
  const signOut   = useSignOut();

  // ── API data ──────────────────────────────────────────────
  const { data: summary, isLoading: summaryLoading } = usePortfolioSummary();
  const { data: chainData, isLoading: chainLoading }  = useByChain();
  const { data: countyData, isLoading: countyLoading } = useByCounty();
  const { data: evaluation } = useEvaluation();

  // Derived values — safe defaults while loading
  const s = summary;
  const n = (v: string | undefined) => number(Number(v ?? 0));
  const m = (v: string | undefined) => money(Number(v ?? 0));

  const allCount      = Number(s?.count        ?? 0);
  const allCost       = Number(s?.cost         ?? 0);
  const allGrant      = Number(s?.grant        ?? 0);
  const allContrib    = Number(s?.contribution ?? 0);
  const allBudget     = Number(s?.budget       ?? 0);
  const allMembers    = Number(s?.members      ?? 0);
  const allWomen      = Number(s?.women        ?? 0);
  const allMen        = Number(s?.men          ?? 0);
  const allYouth      = Number(s?.youth        ?? 0);
  const allPwd        = Number(s?.pwd          ?? 0);
  const allToday      = Number(s?.jobs_today   ?? 0);
  const allYear1      = Number(s?.jobs_year1   ?? 0);
  const allYear3      = Number(s?.jobs_year3   ?? 0);
  const allCounties   = Number(s?.counties     ?? 0);
  const allReviews    = Number(s?.reviews      ?? 0);
  const allMissing    = Number(s?.missing      ?? 0);
  const allWithin     = allCount - allReviews - allMissing;

  // Chart data
  const sectors = chainData ?? [];
  const top5 = sectors.slice(0, 5).map(v => ({
    name: v.name.length > 20 ? v.name.slice(0, 18) + '…' : v.name,
    value: Number(v.count),
  }));
  const others = sectors.slice(5).reduce((s, v) => s + Number(v.count), 0);
  if (others) top5.push({ name: 'Other sectors', value: others });

  const chartSectors = sectors.slice(0, 5).map(v => ({
    name: v.name.length > 14 ? v.name.slice(0, 12) + '…' : v.name,
    grant: Number(v.grant) / 1e6,
    cash:  (Number(v.cost) - Number(v.grant)) / 1e6,
  }));

  const countyGroups = countyData ?? [];
  const employment = [
    { name: 'Baseline', jobs: allToday },
    { name: 'Year 1',   jobs: allYear1 },
    { name: 'Year 3',   jobs: allYear3 },
  ];

  useEffect(() => {
    const preferred = localStorage.getItem('kjet-theme') === 'dark';
    setDark(preferred);
    document.documentElement.classList.toggle('dark', preferred);
    const update = () =>
      setTime(
        new Date().toLocaleTimeString('en-KE', {
          hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi',
        }) + ' EAT',
      );
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, []);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('kjet-theme', next ? 'dark' : 'light');
  };

  return (
    <div className="dashboard-shell">
      {/* ── Sidebar ──────────────────────────────────────────── */}
      <aside className={`sidebar ${menu ? 'open' : ''}`}>
        <Link to="/" className="brand">
          <div className="brand-mark"><Layers3 size={23} /></div>
          <div>
            <strong>KJET<span className="text-primary">.</span></strong>
            <small>ENTERPRISE TRANSFORMATION</small>
          </div>
        </Link>

        <div className="nav-label">Workspace</div>
        <nav>
          {nav.map(n => (
            <Button asChild variant="ghost" key={n.to} className={`nav-item ${view === n.view ? 'active' : ''}`}>
              <Link to={n.to} onClick={() => setMenu(false)}>
                <n.icon />
                {n.label}
                {n.view === 'clusters' && (
                  <span className="nav-count">{allCount || 85}</span>
                )}
              </Link>
            </Button>
          ))}
        </nav>
      </aside>

      {/* ── Workspace ────────────────────────────────────────── */}
      <div className="workspace">
        <header className="topbar">
          <Button className="mobile-menu" variant="ghost" size="icon"
            title="Toggle navigation" aria-label="Toggle navigation"
            onClick={() => setMenu(!menu)}>
            {menu ? <X /> : <Menu />}
          </Button>

          <label className="global-search">
            <Search size={16} />
            <input
              aria-label="Global portfolio search"
              value={query}
              onChange={e => { setQuery(e.target.value); setPage(1); }}
              placeholder="Search across the portfolio..."
            />
          </label>

          <div className="topbar-right">
            <span className="live-label">
              <span className="live-dot" />Portfolio data · {time}
            </span>
            <Button variant="outline" size="icon"
              aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
              title={dark ? 'Light theme' : 'Dark theme'}
              onClick={toggleTheme}>
              {dark ? <Sun /> : <Moon />}
            </Button>
            {/* User avatar + sign-out */}
            <div className="topbar-user">
              <div className="avatar" title={session?.name ?? 'Signed in'}>
                {session?.name
                  ? session.name
                      .replace(/([a-z])([A-Z])/g, '$1 $2')
                      .split(/\s+/)
                      .slice(0, 2)
                      .map(w => w[0])
                      .join('')
                      .toUpperCase()
                  : '--'}
              </div>
              <Button
                variant="ghost" size="icon"
                title="Sign out"
                aria-label="Sign out"
                onClick={async () => {
                  await signOut.mutateAsync();
                  navigate({ to: '/login' });
                }}
              >
                <LogOut size={16} className="text-muted-foreground" />
              </Button>
            </div>
          </div>
        </header>

        <main className="content">
          <div className="breadcrumb">
            KJET Project <ChevronRight size={10} /> Cohort 1 <ChevronRight size={10} />
            <span className="text-foreground">{titles[view][0]}</span>
          </div>

          <div className="page-heading">
            <div>
              <h1>{titles[view][0]}</h1>
              <p>{titles[view][1]}</p>
            </div>
            <div className="heading-actions">
              <span className="cohort-badge"><CalendarDays size={13} />Cohort 1 · 2026</span>
              {view !== 'grant-ready' && (
                <Button size="sm" onClick={() => exportCSV(exportRows)} disabled={exportRows.length === 0}>
                  <Download />Export CSV
                </Button>
              )}
            </div>
          </div>

          {/* ── OVERVIEW ──────────────────────────────────────── */}
          {view === 'overview' && (
            <>
              <div className="metrics-grid">
                <Metric label="Total clusters" value={n(s?.count)} icon={Building2} loading={summaryLoading}>
                  <span className="badge success"><Globe2 size={10} />{allCounties} counties</span>
                  <span>National coverage</span>
                </Metric>
                <Metric label="Total eligible project cost" value={m(s?.cost)} icon={CircleDollarSign} loading={summaryLoading}>
                  <span>Machinery &amp; bundled services</span>
                </Metric>
                <Metric label="KJET grant requested" value={m(s?.grant)} icon={Wallet} loading={summaryLoading}>
                  <span className="badge">{percent(allGrant, allCost).toFixed(1)}% of cost</span>
                  <span>Requested, not disbursed</span>
                </Metric>
                <Metric label="Cluster cash co-investment" value={m(s?.contribution)} icon={Handshake} loading={summaryLoading}>
                  <span className="badge success">{percent(allContrib, allCost).toFixed(1)}% of cost</span>
                  <span>Applicant commitments</span>
                </Metric>
                <Metric label="Total members represented" value={n(s?.members)} icon={Users} loading={summaryLoading}>
                  <span className="badge">{percent(allWomen, allMembers).toFixed(1)}% women</span>
                  <span className="badge success">{percent(allYouth, allMembers).toFixed(1)}% youth</span>
                </Metric>
                <Metric label="Projected jobs · Year 3" value={n(s?.jobs_year3)} icon={BriefcaseBusiness} loading={summaryLoading}>
                  <span className="badge success"><TrendingUp size={10} />Year 3 outlook</span>
                  <span>Applicant-reported</span>
                </Metric>
              </div>

              {evaluation && evaluation.data.length > 0 && (
                <ChartPanel
                  title="Top clusters by evaluation score"
                  subtitle={`Grant-ready list: ${evaluation.summary.clusters} of ${evaluation.meta.evaluated} evaluated clusters, subject to due diligence and World Bank no-objection`}
                  legend={<Button asChild variant="outline" size="sm"><Link to="/grant-ready">View all<ArrowUpRight /></Link></Button>}
                >
                  <div className="top-list">
                    {evaluation.data.slice(0, 5).map((r) => (
                      <button type="button" key={r.application_number} className="top-row" onClick={() => setSelectedId(r.application_number)}>
                        <span className={`gr-rank ${r.shortlist_rank === 1 ? 'top' : ''}`}>{r.shortlist_rank}</span>
                        <span style={{ minWidth: 0 }}>
                          <div className="top-name">{r.cluster_name}</div>
                          <div className="top-sub">{r.county} · {r.value_chain.replace(/_/g, ' ')} · <BandChip band={r.band} score={r.total_score} /></div>
                        </span>
                        <ScoreBar score={r.total_score} compact />
                      </button>
                    ))}
                  </div>
                </ChartPanel>
              )}

              <Tabs defaultValue="investment" className="overview-tabs">
                <TabsList className="overview-tablist">
                  <TabsTrigger value="investment"><Wallet size={13} className="mr-1.5" />Co-investment</TabsTrigger>
                  <TabsTrigger value="inclusion"><Users size={13} className="mr-1.5" />Jobs &amp; inclusion</TabsTrigger>
                  <TabsTrigger value="counties"><MapPin size={13} className="mr-1.5" />County coverage</TabsTrigger>
                  <TabsTrigger value="matching"><ShieldCheck size={13} className="mr-1.5" />Matching review</TabsTrigger>
                </TabsList>

                {/* Co-investment */}
                <TabsContent value="investment">
                  {chainLoading ? (
                    <div className="analytics-grid"><LoadingPanel /><LoadingPanel /></div>
                  ) : (
                    <>
                      <div className="analytics-grid">
                        <ChartPanel
                          title="Investment by value chain"
                          subtitle="Top 5 sectors by eligible project cost · KES millions"
                          legend={<div className="chart-legend"><span><i className="legend-dot" />Grant</span><span><i className="legend-dot secondary" />Cost remainder</span></div>}
                          footer={<><span>Eligible portfolio value</span><strong className="text-foreground">{money(allCost)}</strong></>}
                        >
                          <div className="chart-box">
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={chartSectors} margin={{ top: 15, right: 5, left: -15, bottom: 0 }} barGap={5}>
                                <CartesianGrid vertical={false} strokeDasharray="3 4" />
                                <XAxis dataKey="name" axisLine={false} tickLine={false} dy={7} />
                                <YAxis axisLine={false} tickLine={false} tickFormatter={v => `${v}M`} />
                                <Tooltip formatter={(v, name) => [money(Number(v) * 1e6), name === 'grant' ? 'Grant requested' : 'Eligible cost remainder']} contentStyle={tooltipStyle} cursor={{ fill: 'var(--muted)' }} />
                                <Bar dataKey="grant" fill="var(--chart-1)" radius={[3, 3, 0, 0]} maxBarSize={25} />
                                <Bar dataKey="cash"  fill="var(--chart-2)" radius={[3, 3, 0, 0]} maxBarSize={25} />
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </ChartPanel>

                        <ChartPanel title="Value chain distribution" subtitle="Beneficiary clusters by sector"
                          footer={<><span>Value chains represented</span><strong className="text-foreground">{sectors.length} sectors</strong></>}>
                          <div className="sector-layout">
                            <div className="sector-donut">
                              <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                  <Pie data={top5} dataKey="value" innerRadius="67%" outerRadius="86%" paddingAngle={3} stroke="none">
                                    {top5.map((v, i) => <Cell key={v.name} fill={CHART_COLORS[i]} />)}
                                  </Pie>
                                  <Tooltip contentStyle={tooltipStyle} />
                                </PieChart>
                              </ResponsiveContainer>
                              <div className="donut-center"><strong>{allCount}</strong><span>Total clusters</span></div>
                            </div>
                            <div className="sector-legend">
                              {top5.map((v, i) => (
                                <div className="sector-row" key={v.name}>
                                  <i className={`sector-swatch sector-${i + 1}`} />
                                  <span>{v.name}</span><strong>{v.value}</strong>
                                </div>
                              ))}
                            </div>
                          </div>
                        </ChartPanel>
                      </div>

                      <div className="analytics-grid">
                        <ChartPanel title="Full operational budget" subtitle="Section 5 versus eligible Section 3 costs">
                          <div className="profile-metrics" style={{ marginBottom: 0 }}>
                            <div><div className="metric-label">Section 5 total</div><div className="metric-value">{money(allBudget)}</div></div>
                            <div><div className="metric-label">Eligible cost</div><div className="metric-value">{money(allCost)}</div></div>
                          </div>
                          <p className="text-xs leading-7 text-muted-foreground mt-4">The operational budget can include working capital, buildings and pre-operating expenses outside eligible machinery costs.</p>
                        </ChartPanel>
                      </div>
                    </>
                  )}
                </TabsContent>

                {/* Jobs & inclusion */}
                <TabsContent value="inclusion">
                  {summaryLoading ? (
                    <div className="analytics-grid"><LoadingPanel /><LoadingPanel /></div>
                  ) : (
                    <div className="analytics-grid">
                      <ChartPanel title="Employment projections" subtitle="Baseline and applicant-reported outlook">
                        <div className="chart-box">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={employment} margin={{ left: 5, right: 10 }}>
                              <CartesianGrid vertical={false} strokeDasharray="3 4" />
                              <XAxis dataKey="name" axisLine={false} tickLine={false} />
                              <YAxis axisLine={false} tickLine={false} tickFormatter={v => `${(v / 1e6).toFixed(1)}M`} />
                              <Tooltip formatter={v => number(Number(v))} contentStyle={tooltipStyle} />
                              <Bar dataKey="jobs" fill="var(--primary)" radius={[4, 4, 0, 0]} maxBarSize={65} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                        <div className="notice"><AlertTriangle size={15} /><span>Projections are retained exactly as supplied. Large figures require validation.</span></div>
                      </ChartPanel>
                      <ChartPanel title="Membership representation" subtitle="Gender distribution and overlapping inclusion groups">
                        <div className="detail-grid">
                          <div><div className="detail-label">Women</div><div className="metric-value">{number(allWomen)}</div></div>
                          <div><div className="detail-label">Men</div><div className="metric-value">{number(allMen)}</div></div>
                          <div><div className="detail-label">Youth</div><div className="metric-value">{number(allYouth)}</div></div>
                          <div><div className="detail-label">Persons with disabilities</div><div className="metric-value">{number(allPwd)}</div></div>
                        </div>
                        <p className="text-xs leading-7 text-muted-foreground mt-4">Youth and PWD are overlapping groups and should not be added to the gender total.</p>
                      </ChartPanel>
                    </div>
                  )}
                </TabsContent>

                {/* County coverage */}
                <TabsContent value="counties">
                  {countyLoading ? (
                    <div className="analytics-grid"><LoadingPanel /><LoadingPanel /></div>
                  ) : (
                    <div className="analytics-grid">
                      <ChartPanel title="Leading counties by investment" subtitle="Top 10 by total eligible project cost · KES millions">
                        <div className="h-[360px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={countyGroups.slice(0, 10).map(v => ({ ...v, cost: Number(v.cost) / 1e6 }))} layout="vertical" margin={{ left: 15, right: 20 }}>
                              <CartesianGrid horizontal={false} strokeDasharray="3 4" />
                              <XAxis type="number" tickFormatter={v => `${v}M`} axisLine={false} tickLine={false} />
                              <YAxis type="category" dataKey="name" width={95} axisLine={false} tickLine={false} />
                              <Tooltip formatter={v => money(Number(v) * 1e6)} contentStyle={tooltipStyle} />
                              <Bar dataKey="cost" fill="var(--primary)" radius={[0, 3, 3, 0]} barSize={17} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </ChartPanel>
                      <ChartPanel title="National reach" subtitle="Cohort 1 geographic distribution">
                        <div className="metric-value mt-3">{allCounties} / 47 counties</div>
                        <p className="text-xs text-muted-foreground mt-3 mb-6">{number(allCount)} clusters represented across Kenya</p>
                        <div className="max-h-[260px] overflow-auto space-y-3">
                          {[...countyGroups].sort((a, b) => a.name.localeCompare(b.name)).map(v => (
                            <div key={v.name} className="flex items-center justify-between border-b border-border pb-2 text-xs">
                              <span>{v.name}</span>
                              <div className="flex gap-3">
                                <span className="text-muted-foreground">{v.count} clusters</span>
                                <strong>{money(Number(v.cost))}</strong>
                              </div>
                            </div>
                          ))}
                        </div>
                      </ChartPanel>
                    </div>
                  )}
                </TabsContent>

                {/* Matching review */}
                <TabsContent value="matching">
                  <div className="notice mb-6">
                    <AlertTriangle size={18} />
                    <span>
                      <strong>{allReviews} applications require matching-rule review; {allMissing} have missing eligible project costs.</strong><br />
                      Grant must be at most 50% and KES 32M; cluster cash at least 50%.
                    </span>
                  </div>
                  <div className="analytics-grid">
                    <ChartPanel title="Matching rule breakdown" subtitle="All clusters assessed against co-investment limits">
                      <div className="profile-job-grid">
                        <div><strong className="text-success">{allWithin}</strong><span>Within limits</span></div>
                        <div><strong className="text-warning">{allReviews}</strong><span>Review required</span></div>
                        <div><strong>{allMissing}</strong><span>Missing financials</span></div>
                      </div>
                      <Button asChild variant="outline" size="sm" className="mt-4"><Link to="/clusters">Open cluster explorer</Link></Button>
                    </ChartPanel>
                  </div>
                </TabsContent>
              </Tabs>
            </>
          )}

          {/* ── GRANT-READY ─────────────────────────────────── */}
          {view === 'grant-ready' && <GrantReady onSelect={setSelectedId} />}

          {/* ── CLUSTERS ────────────────────────────────────── */}
          {view === 'clusters' && (
            <>
            <AssistantPanel onSelect={setSelectedId} />
            <ClusterExplorer
              onSelect={setSelectedId}
              onRowsChange={setExportRows}
              query={query} setQuery={setQuery}
              county={county} setCounty={setCounty}
              chain={chain} setChain={setChain}
              sort={sort} setSort={setSort}
              shortlist={shortlist} setShortlist={setShortlist}
              page={page} setPage={setPage}
              review={false}
            />
            </>
          )}

          <footer className="page-footer">
            <span>Republic of Kenya · Micro and Small Enterprises Authority · KJET Component 2</span>
            <span>Source: Cohort 1 applications · All amounts in KES</span>
          </footer>
        </main>
      </div>

      <ClusterProfile
        applicationNumber={selectedId}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}
