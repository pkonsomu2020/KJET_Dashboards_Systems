import { useMemo, useState, type ReactNode } from 'react';
import { ArrowUpRight, ExternalLink, FileText, Info, MapPin, RotateCcw, Search, SearchX, Sheet, Trophy, Users, FolderOpen, Repeat } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { number } from '@/data/portfolio';
import { useFinalists } from '@/hooks/usePortfolio';
import type { Finalist } from '@/data/api';
import { FinalistProfile } from './finalist-profile';
import { CountUp, PageLoader } from './motion';

const chain = (v: string | null | undefined) => (v ?? '').replace(/_/g, ' ');
const num = (v: number | null | undefined, digits = 0) => (v == null ? '-' : v.toLocaleString('en-KE', { maximumFractionDigits: digits }));
const label = (f: Finalist) => f.cluster_name ?? `Applicant ${f.applicant_id}`;

/** What differs between the cohorts: how many are picked in each county, where the scores are read from. */
const COHORT = {
  1: { perCounty: 'Top 2', who: 'The top 2 applicants in each county who passed eligibility', tab: 'TOP2-OP' },
  2: { perCounty: 'Top 6', who: 'The top 6 applicants in each county who met the eligibility criteria', tab: 'Selected' },
} as const;

function Loading() {
  return <PageLoader label="Loading the finalists" />;
}

export function Stat({ label: l, value, icon: Icon, children }: { label: string; value: string; icon: typeof Users; children?: ReactNode }) {
  return (
    <article className="metric">
      <div className="metric-label"><span>{l}</span><Icon /></div>
      <div className="metric-value"><CountUp value={value} /></div>
      <div className="metric-foot">{children}</div>
    </article>
  );
}

/** A Cohort 1 alternate carried into Cohort 2 keeps its Cohort 1 number as its Application ID ("Applicant_257"); the sheet's C1 Alternates tab lists every one of them. */
export const isCohort1Alternate = (f: Finalist) => f.cohort === 2 && /^\d+$/.test(f.applicant_id);

// ── The finalists page ──

type Filters = { q: string; county: string; chain: string; tier: string };
const NO_FILTERS: Filters = { q: '', county: '', chain: '', tier: '' };

export function FinalistsPage({ cohort }: { cohort: 1 | 2 }) {
  const { data, isLoading, error } = useFinalists(cohort);
  const [f, setF] = useState<Filters>(NO_FILTERS);
  const [selected, setSelected] = useState<string | null>(null);
  const all = data?.data ?? [];
  const items = all[0]?.criteria ?? [];
  const counties = useMemo(() => [...new Set(all.map((r) => r.county))].sort(), [all]);
  const chains = useMemo(() => [...new Set(all.map((r) => r.value_chain).filter(Boolean) as string[])].sort(), [all]);
  const tiers = useMemo(() => [...new Set(all.map((r) => r.tier).filter(Boolean) as string[])].sort(), [all]);
  const rows = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    return all.filter((r) =>
      (!q || label(r).toLowerCase().includes(q) || r.county.toLowerCase().includes(q) || (r.registration_number ?? '').toLowerCase().includes(q) || (r.application_id ?? '').toLowerCase().includes(q) || (r.application_number ?? '').toLowerCase().includes(q))
      && (!f.county || r.county === f.county) && (!f.chain || r.value_chain === f.chain) && (!f.tier || r.tier === f.tier));
  }, [all, f]);

  if (isLoading) return <Loading />;
  if (error || !data) return <div className="notice"><Info size={16} /><span>The finalists could not be loaded. Please refresh the page.</span></div>;

  const text = COHORT[cohort];
  const composite = all.filter((r) => r.composite != null);
  const avg = composite.length ? composite.reduce((s, r) => s + (r.composite ?? 0), 0) / composite.length : null;
  const docs = all.reduce((s, r) => s + r.documents.total, 0);
  const dirty = f.q || f.county || f.chain || f.tier;
  const alternates = all.filter(isCohort1Alternate).length;

  return (
    <>
      <div className="metrics-grid">
        <Stat label="Finalists" value={number(all.length)} icon={Trophy}>
          <span className="badge success"><MapPin size={10} />{counties.length} counties</span><span>{text.perCounty} in each county</span>
        </Stat>
        {cohort === 1 ? (
          <Stat label="Passed eligibility" value={number(all.filter((r) => /^pass/i.test(r.result ?? '')).length)} icon={Users}>
            <span>Pass in the sheet's PASS/FAIL column</span>
          </Stat>
        ) : (
          <Stat label="Cohort 1 alternates" value={number(alternates)} icon={Repeat}>
            <span>Carried over from Cohort 1; their Application IDs are Cohort 1 numbers</span>
          </Stat>
        )}
        <Stat label="Average composite score" value={avg == null ? '-' : avg.toFixed(1)} icon={Trophy}>
          <span>{cohort === 1 ? 'Total less penalty points' : 'Weighted scores, equity points less penalties'}</span>
        </Stat>
        <Stat label="Value chains" value={number(chains.length)} icon={FolderOpen}>
          <span>{chains.slice(0, 3).map(chain).join(', ')}{chains.length > 3 ? '…' : ''}</span>
        </Stat>
        <Stat label="Documents" value={number(docs)} icon={FileText}>
          <span>{data.meta.forms_read} of {all.length} application forms read</span>
        </Stat>
      </div>

      <div className="chart-panel">
        <div className="panel-header">
          <div>
            <h2>Cohort {cohort} finalists</h2>
            <p>{text.who}, as scored in the Cohort {cohort} spreadsheet (tab {text.tab}). Read live from the sheet.</p>
          </div>
          <a className="fn-link" href={data.meta.sheet_link} target="_blank" rel="noreferrer"><Sheet size={13} />Open the spreadsheet<ExternalLink size={11} /></a>
        </div>
        {data.meta.sheet.last_error && <div className="notice"><Info size={16} /><span>The spreadsheet could not be re-read just now. The last good copy is shown and the page will try again in a few seconds.</span></div>}
        {data.meta.forms_wrong > 0 && (
          <div className="notice">
            <Info size={16} />
            <span>{data.meta.forms_wrong} finalist folder{data.meta.forms_wrong === 1 ? '' : 's'} on file hold another cluster's application, so nothing from {data.meta.forms_wrong === 1 ? 'it is' : 'them is'} shown. Open a finalist to see which.</span>
          </div>
        )}
        <div className="filters ev-filters">
          <label className="filter-search">
            <Search size={15} />
            <input aria-label="Search finalists" placeholder="Search cluster, county, Application ID or registration number..." value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
          </label>
          <select className="filter-select" aria-label="Filter by county" value={f.county} onChange={(e) => setF({ ...f, county: e.target.value })}>
            <option value="">All counties</option>{counties.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="filter-select" aria-label="Filter by value chain" value={f.chain} onChange={(e) => setF({ ...f, chain: e.target.value })}>
            <option value="">All value chains</option>{chains.map((c) => <option key={c} value={c}>{chain(c)}</option>)}
          </select>
          <select className="filter-select" aria-label="Filter by tier" value={f.tier} onChange={(e) => setF({ ...f, tier: e.target.value })}>
            <option value="">All tiers</option>{tiers.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          {dirty && <Button variant="ghost" size="icon" title="Clear filters" aria-label="Clear filters" onClick={() => setF(NO_FILTERS)}><RotateCcw /></Button>}
          <span className="ev-count">{rows.length === all.length ? `${all.length} finalists` : `${rows.length} of ${all.length} finalists`}</span>
        </div>

        {items.length > 0 && (
          <p className="fn-legend">{items.map((c) => <span key={c.code}><strong>{c.code}</strong> {c.label}</span>)}</p>
        )}

        {rows.length === 0 ? (
          <div className="empty-state"><SearchX size={28} /><p>No finalists match these filters.</p></div>
        ) : (
          <div className="fn-scroll">
            <table className="portfolio-table fn-table">
              <colgroup><col style={{ width: '24%' }} /><col style={{ width: '13%' }} />{items.map((c) => <col key={c.code} style={{ width: '6%' }} />)}<col style={{ width: '13%' }} /><col style={{ width: '14%' }} /></colgroup>
              <thead>
                <tr>
                  <th>Finalist</th><th>County</th>
                  {items.map((c) => <th key={c.code} className="fn-rate-head" title={`${c.code} ${c.label} (rating out of 5)`}>{c.code}</th>)}
                  <th>Composite score</th><th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.applicant_id}>
                    <td>
                      <div className="cluster-name">{label(r)}<span className="cluster-id">{r.application_id ?? `Applicant ${r.applicant_id}`}</span></div>
                    </td>
                    <td>{r.county}</td>
                    {items.map((c, i) => {
                      const k = r.criteria[i];
                      return (
                        <td key={c.code} className="fn-rate" title={`${c.code} ${c.label}: ${k?.logic ?? 'no comment'}`}>
                          <strong>{k?.rating ?? '-'}<small>/5</small></strong>
                        </td>
                      );
                    })}
                    <td>
                      <strong>{num(r.composite, 1)}</strong>
                      <span className="gr-sub">{r.tier ?? 'No tier'} · rank {r.rank ?? '-'}{r.rank_in_county != null ? ` · #${r.rank_in_county} in county` : ''}</span>
                    </td>
                    <td>
                      <div className="ev-actions-cell">
                        <Button variant="ghost" size="sm" className="profile-link" aria-label={`View profile of ${label(r)}`} title="Open the finalist's full profile" onClick={() => setSelected(r.applicant_id)}>
                          View profile<ArrowUpRight />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <FinalistProfile cohort={cohort} applicantId={selected} rules={data.meta.rules} onClose={() => setSelected(null)} />
    </>
  );
}
