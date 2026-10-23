import { Fragment, useState } from 'react';
import {
  Award, ArrowUpRight, BriefcaseBusiness, ChevronDown, ChevronUp, Download, Info,
  Loader2, MapPin, ShieldCheck, SearchX, Users, Wallet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { money, number, percent } from '@/data/portfolio';
import { useEvaluation } from '@/hooks/usePortfolio';
import type { ShortlistRow } from '@/data/api';
import { BandChip, GateChip, ScoreBar } from './evaluation-ui';

function exportShortlist(rows: ShortlistRow[]) {
  const head = [
    'Rank', 'Application number', 'Cluster name', 'County', 'Value chain', 'Score (/100)', 'Band',
    'Maximum eligible grant (evaluation, KES)', 'Grant requested (Drive, KES)', 'Financial screening', 'Due diligence',
    'E&S disposition', 'System recommendation', 'Why this cluster',
  ];
  const csv = [head, ...rows.map((r) => [
    r.shortlist_rank, r.application_number, r.cluster_name, r.county, r.value_chain, r.total_score, r.band,
    r.max_eligible_grant, r.grant_requested, r.financial_screening, r.due_diligence, r.es_disposition,
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
  const [showAllWaiting, setShowAllWaiting] = useState(false);

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
  const waiting = showAllWaiting ? data.waiting : data.waiting.slice(0, 8);
  const imported = data.meta.imported_at
    ? new Date(data.meta.imported_at).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' })
    : null;

  return (
    <>
      <div className="gr-banner">
        <ShieldCheck size={17} />
        <div>
          <strong>Recommended for grant support, not yet funded.</strong> These {s.clusters} clusters scored 70 or more out of 100 and
          passed eligibility. Each one remains subject to due diligence, environmental and social clearance, and World Bank
          no-objection. Check the status chips before relying on a cluster.
        </div>
      </div>

      <div className="metrics-grid">
        <Tile label="Grant-ready clusters" value={String(s.clusters)} icon={Award}>
          <span>of {data.meta.evaluated} clusters evaluated</span>
        </Tile>
        <Tile label="Average score" value={`${s.average_score}`} icon={ShieldCheck}>
          <span>out of 100 · range {Math.round(Math.min(...data.data.map((r) => Number(r.total_score))))} to {Math.round(Math.max(...data.data.map((r) => Number(r.total_score))))}</span>
        </Tile>
        <Tile label="Maximum eligible grant" value={money(s.eligible_grant)} icon={Wallet}>
          <span>per evaluation</span>
          <span className="badge">Requested {money(s.requested_per_drive)}</span>
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
          <div className="table-scroll">
            <table className="portfolio-table">
              <thead>
                <tr>
                  <th style={{ width: 52 }}>Rank</th>
                  <th>Cluster / application ID</th>
                  <th>County &amp; value chain</th>
                  <th>Score</th>
                  <th className="gr-num">Maximum eligible grant</th>
                  <th>Status checks</th>
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
                          <strong>{r.max_eligible_grant != null ? money(Number(r.max_eligible_grant), false) : 'Not stated'}</strong>
                          <span className="gr-sub">Requested (Drive): {r.grant_requested != null ? money(Number(r.grant_requested), false) : 'n/a'}</span>
                          {r.figure_notes.length > 0 && (
                            <span className="gr-note"
                              title={r.figure_notes.map((n) => `${n.field}: evaluation ${money(n.evaluation, false)}, Drive ${money(n.drive, false)}`).join('\n')}>
                              <Info size={11} />Figures differ from Drive
                            </span>
                          )}
                        </td>
                        <td>
                          <div className="gr-gates">
                            <GateChip label="Finance" value={r.financial_screening} />
                            <GateChip label="Due diligence" value={r.due_diligence} />
                            <GateChip label="E&S" value={r.es_disposition} empty="Pending" />
                          </div>
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
                          <td colSpan={7}>
                            {r.shortlist_reason && <p style={{ margin: 0, color: 'var(--foreground)' }}><strong>Why it is on the list: </strong>{r.shortlist_reason}</p>}
                            <ul>
                              <li><strong>System recommendation:</strong> {r.system_recommendation ?? 'Not stated'}</li>
                              <li><strong>Technical recommendation:</strong> {r.technical_rec ?? 'Not stated'}</li>
                              <li><strong>Eligibility:</strong> {r.eligibility ?? 'Not stated'} · <strong>Data readiness:</strong> {r.data_readiness ?? 'Not stated'}</li>
                              <li><strong>MSEA decision:</strong> {r.msea_decision ?? 'Not yet decided'} · <strong>World Bank:</strong> {r.wb_status ?? 'Not yet submitted'}</li>
                              {r.figure_notes.map((n) => (
                                <li key={n.field}><strong>Figures differ from Drive ({n.field}):</strong> the evaluation uses {money(n.evaluation, false)}; the application on Drive shows {money(n.drive, false)}.</li>
                              ))}
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

      {data.waiting.length > 0 && (
        <section className="gr-section">
          <div className="gr-section-head">
            <div>
              <h2>Scored 70 or more, eligibility still on hold ({data.waiting.length})</h2>
              <p>
                These clusters reached the recommended score but are not on the list yet, because the eligibility check is still open
                (clarifications outstanding). They can move up once eligibility is cleared.
              </p>
            </div>
          </div>
          <div className="chart-panel">
            <div className="table-scroll">
              <table className="portfolio-table">
                <thead>
                  <tr>
                    <th>Cluster / application ID</th>
                    <th>County &amp; value chain</th>
                    <th>Score</th>
                    <th>Why not listed yet</th>
                    <th aria-label="Profile" />
                  </tr>
                </thead>
                <tbody>
                  {waiting.map((w) => (
                    <tr key={w.application_number}>
                      <td>
                        <div className="cluster-name">{w.cluster_name}<span className="cluster-id">{w.application_number}</span></div>
                      </td>
                      <td>
                        {w.county}
                        <div className="mt-1.5"><span className="badge">{w.value_chain.replace(/_/g, ' ')}</span></div>
                      </td>
                      <td><ScoreBar score={w.total_score} compact /></td>
                      <td>
                        <div className="gr-gates">
                          <GateChip label="Eligibility" value={w.eligibility} />
                          <GateChip label="Finance" value={w.financial_screening} />
                        </div>
                      </td>
                      <td>
                        <Button variant="ghost" size="icon" aria-label={`View profile of ${w.cluster_name}`}
                          title="Open full profile and evaluation" onClick={() => onSelect(w.application_number)}>
                          <ArrowUpRight className="text-primary" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.waiting.length > 8 && (
              <div className="table-footer">
                <span>Showing {waiting.length} of {data.waiting.length}</span>
                <Button variant="outline" size="sm" onClick={() => setShowAllWaiting((v) => !v)}>
                  {showAllWaiting ? 'Show fewer' : `Show all ${data.waiting.length}`}
                </Button>
              </div>
            )}
          </div>
        </section>
      )}

      <p className="gr-foot">
        Source: {data.meta.source_file ?? 'evaluation workbook'}{imported ? `, loaded ${imported}` : ''}. Scores follow the evaluation
        scorecard (six weighted criteria, 100 points). Where the evaluation and the application on Drive show different figures, both are
        shown and the application data is never overwritten.
      </p>
    </>
  );
}
