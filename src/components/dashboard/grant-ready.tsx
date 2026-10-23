import { Fragment, useState } from 'react';
import {
  Award, ArrowUpRight, BriefcaseBusiness, ChevronDown, ChevronUp, Download, Info,
  Loader2, MapPin, ShieldCheck, SearchX, Users, Wallet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { money, number, percent } from '@/data/portfolio';
import { useEvaluation } from '@/hooks/usePortfolio';
import type { ShortlistRow } from '@/data/api';
import { BandChip, ScoreBar } from './evaluation-ui';

function exportShortlist(rows: ShortlistRow[]) {
  const head = [
    'Rank', 'Application number', 'Cluster name', 'County', 'Value chain', 'Score (/100)', 'Band',
    'Project cost (Drive, KES)', 'Grant requested (Drive, KES)', 'Financial screening', 'Due diligence',
    'E&S disposition', 'System recommendation', 'Why this cluster',
  ];
  const csv = [head, ...rows.map((r) => [
    r.shortlist_rank, r.application_number, r.cluster_name, r.county, r.value_chain, r.total_score, r.band,
    r.total_project_cost, r.grant_requested, r.financial_screening, r.due_diligence, r.es_disposition,
    r.system_recommendation, r.shortlist_reason,
  ])].map((line) => line.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'KJET-grant-ready-clusters.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function Tile({ label, value, icon: Icon, children }: { label: string; value: string; icon: typeof Users; children: React.ReactNode }) {
  return (
    <article className="metric">
      <div className="metric-label"><span>{label}</span><Icon /></div>
      <div className="metric-value">{value}</div>
      <div className="metric-foot">{children}</div>
    </article>
  );
}

export function GrantReady({ onSelect }: { onSelect: (applicationNumber: string) => void }) {
  const { data, isLoading, error } = useEvaluation();
  const [open, setOpen] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="chart-panel" style={{ minHeight: 240, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 size={26} className="animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="notice"><Info size={16} /><span>The evaluation results could not be loaded. Please refresh the page.</span></div>
    );
  }
  if (data.meta.evaluated === 0 || data.data.length === 0) {
    return (
      <div className="empty-state">
        <SearchX size={30} />
        <p>No evaluation results have been imported yet.</p>
      </div>
    );
  }

  const s = data.summary;

  return (
    <>
      <div className="gr-banner">
        <ShieldCheck size={17} />
        <div>
          <strong>Recommended for grant support, not yet funded.</strong> These {s.clusters} clusters scored 70 or more out of 100 and
          passed eligibility. Each one remains subject to due diligence, environmental and social clearance, and World Bank
          no-objection.
        </div>
      </div>

      <div className="metrics-grid">
        <Tile label="Grant-ready clusters" value={String(s.clusters)} icon={Award}>
          <span>of {data.meta.evaluated} clusters evaluated</span>
        </Tile>
        <Tile label="Average score" value={`${s.average_score}`} icon={ShieldCheck}>
          <span>out of 100 · range {Math.round(Math.min(...data.data.map((r) => Number(r.total_score))))} to {Math.round(Math.max(...data.data.map((r) => Number(r.total_score))))}</span>
        </Tile>
        <Tile label="Grant requested" value={money(s.requested_per_drive)} icon={Wallet}>
          <span>of {money(s.project_cost)} project cost</span>
        </Tile>
        <Tile label="Counties covered" value={String(s.counties)} icon={MapPin}>
          <span>{s.value_chains} value chains</span>
        </Tile>
        <Tile label="Members represented" value={number(s.members)} icon={Users}>
          <span className="badge success">{percent(s.women, s.members).toFixed(1)}% women</span>
        </Tile>
        <Tile label="Projected jobs · Year 3" value={number(s.projected_jobs_year3)} icon={BriefcaseBusiness}>
          <span>applicant-reported</span>
        </Tile>
      </div>

      <section className="gr-section">
        <div className="gr-section-head">
          <div>
            <h2>Grant-ready clusters</h2>
            <p>Ranked by evaluation score. Select a row to see why it is on the list, or open the full profile.</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => exportShortlist(data.data)}><Download />Export CSV</Button>
        </div>

        <div className="chart-panel">
          <div className="fit-wrap">
            <table className="portfolio-table fit-table">
              <colgroup>
                <col style={{ width: 58 }} />
                <col style={{ width: '28%' }} />
                <col style={{ width: '17%' }} />
                <col style={{ width: '20%' }} />
                <col />
                <col style={{ width: 52 }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Cluster / application ID</th>
                  <th>County &amp; value chain</th>
                  <th>Score</th>
                  <th className="gr-num">Grant requested</th>
                  <th aria-label="Profile" />
                </tr>
              </thead>
              <tbody>
                {data.data.map((r) => {
                  const isOpen = open === r.application_number;
                  return (
                    <Fragment key={r.application_number}>
                      <tr>
                        <td><span className={`gr-rank ${r.shortlist_rank === 1 ? 'top' : ''}`}>{r.shortlist_rank}</span></td>
                        <td>
                          <div className="cluster-name">
                            {r.cluster_name}
                            <span className="cluster-id">{r.application_number}</span>
                          </div>
                          <button type="button" className="gr-toggle" aria-expanded={isOpen}
                            onClick={() => setOpen(isOpen ? null : r.application_number)}>
                            {isOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                            {isOpen ? 'Hide details' : 'Why this cluster'}
                          </button>
                        </td>
                        <td>
                          {r.county}
                          <div className="mt-1.5"><span className="badge" title={r.value_chain}>{r.value_chain.replace(/_/g, ' ')}</span></div>
                        </td>
                        <td><ScoreBar score={r.total_score} /><span className="gr-sub"><BandChip band={r.band} score={r.total_score} /></span></td>
                        <td className="gr-num">
                          <strong>{r.grant_requested != null ? money(Number(r.grant_requested), false) : 'n/a'}</strong>
                          <span className="gr-sub">Project cost: {r.total_project_cost != null ? money(Number(r.total_project_cost), false) : 'n/a'}</span>
                        </td>
                        <td>
                          <Button variant="ghost" size="icon" aria-label={`View profile of ${r.cluster_name}`}
                            title="Open full profile and evaluation" onClick={() => onSelect(r.application_number)}>
                            <ArrowUpRight className="text-primary" />
                          </Button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="gr-why">
                          <td colSpan={6}>
                            {r.shortlist_reason && <p style={{ margin: 0, color: 'var(--foreground)' }}><strong>Why it is on the list: </strong>{r.shortlist_reason}</p>}
                            <ul>
                              <li><strong>System recommendation:</strong> {r.system_recommendation ?? 'Not stated'}</li>
                              <li><strong>Technical recommendation:</strong> {r.technical_rec ?? 'Not stated'}</li>
                              <li><strong>Eligibility:</strong> {r.eligibility ?? 'Not stated'} · <strong>Data readiness:</strong> {r.data_readiness ?? 'Not stated'}</li>
                              <li><strong>MSEA decision:</strong> {r.msea_decision ?? 'Not yet decided'} · <strong>World Bank:</strong> {r.wb_status ?? 'Not yet submitted'}</li>
                            </ul>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}
