import { Loader2 } from 'lucide-react';
import { money } from '@/data/portfolio';
import { useEvaluationDetail } from '@/hooks/usePortfolio';
import type { EvalDetail } from '@/data/api';
import { BandChip, ScoreBar, StatusChip } from './evaluation-ui';

const kes = (v: number | null | undefined) => (v == null ? 'Not stated' : money(v, false));
const pct = (v: number | null | undefined) => (v == null ? 'Not stated' : `${(v * 100).toFixed(1)}%`);
const yn = (v: boolean | null | undefined) => (v == null ? 'Not stated' : v ? 'Yes' : 'No');

function Row({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'good' | 'bad' | 'warn' | undefined }) {
  return (
    <div className="ev-row">
      <span>{label}</span>
      <strong className={tone ? `ev-${tone}` : undefined}>{value}</strong>
    </div>
  );
}

/** Loads one cluster's full evaluation and hands it to `children`. */
export function WithDetail({ applicationNumber, children }: { applicationNumber: string; children: (d: EvalDetail) => React.ReactNode }) {
  const { data, isLoading, error } = useEvaluationDetail(applicationNumber);
  if (isLoading) return <div className="ev-loading"><Loader2 size={18} className="animate-spin text-muted-foreground" /></div>;
  if (error || !data) return <p className="ev-empty">The evaluation of this cluster could not be loaded.</p>;
  return <>{children(data)}</>;
}

/** Financial screening: the 50-50 checks, worked out from the figures the evaluation was made on. */
export function FinancialPanel({ d }: { d: EvalDetail }) {
  const f = d.financial_detail;
  const c = f.checks;
  return (
    <div className="ev-panel">
      <div className="ev-cols">
        <div>
          <h4>Figures used by the evaluation</h4>
          <Row label="Total project cost" value={kes(f.figures.total)} />
          <Row label="Matching grant requested" value={kes(f.figures.grant)} />
          <Row label="Cluster cash contribution" value={kes(f.figures.contribution)} />
          <Row label="Machinery subtotal" value={kes(f.figures.machinery)} />
          <Row label="Services subtotal" value={kes(f.figures.services)} />
          {d.financial.drive.differs && (
            <>
              <h4 style={{ marginTop: 12 }}>Current application</h4>
              <Row label="Total project cost" value={kes(d.financial.drive.total)} tone="warn" />
              <Row label="Matching grant requested" value={kes(d.financial.drive.grant)} tone="warn" />
              <Row label="Cluster cash contribution" value={kes(d.financial.drive.contribution)} tone="warn" />
            </>
          )}
        </div>
        <div>
          <h4>50-50 rule and category</h4>
          <Row label="Window (by matching grant requested)" value={f.category} />
          <Row label="Cluster cash share of total" value={pct(c.cluster_share)} tone={c.meets_50_percent_cash === false ? 'bad' : undefined} />
          <Row label="Matching grant share of total" value={pct(c.kjet_share)} />
          <Row label="Meets the 50% cluster cash contribution" value={yn(c.meets_50_percent_cash)} tone={c.meets_50_percent_cash === false ? 'bad' : c.meets_50_percent_cash ? 'good' : undefined} />
          <Row label="Maximum matching grant" value={kes(c.max_eligible_grant)} />
          <Row label="Matching grant above the maximum" value={kes(c.grant_above_max)} tone={c.grant_above_max && c.grant_above_max > 100 ? 'warn' : undefined} />
          <Row label="Minimum cluster cash contribution" value={kes(c.min_cluster_cash)} />
          <Row label="Cluster cash contribution shortfall" value={kes(c.contribution_shortfall)} tone={c.contribution_shortfall ? 'bad' : undefined} />
        </div>
        <div>
          <h4>Arithmetic and documents</h4>
          <Row label="Cluster cash contribution plus matching grant" value={kes(c.contribution_plus_grant)} />
          <Row label="Total minus (cluster cash contribution plus matching grant)" value={kes(c.total_minus_contribution_and_grant)} />
          <Row label="Total minus (machinery plus services)" value={kes(c.total_minus_machinery_and_services)} />
          <Row label="Arithmetic consistent" value={yn(c.arithmetic_consistent)} tone={c.arithmetic_consistent === false ? 'bad' : undefined} />
          <Row label="Placeholder amounts" value={yn(c.implausible_amounts)} />
          <Row label="Document check" value={c.document_check ?? 'Not stated'} tone={c.document_check?.startsWith('Missing') ? 'warn' : undefined} />
        </div>
      </div>
      <div className="ev-result"><span>Screening result</span><StatusChip value={f.result} /></div>
      {d.evaluator_finance.result && d.evaluator_finance.result !== f.result && (
        <p className="ev-note"><strong>Evaluation sheet result: </strong>{d.evaluator_finance.result}. The sheet screened this cluster on the figures it held at the time; the result above uses the figures in the current application.</p>
      )}
      {f.issues.length > 0 && (
        <div className="ev-issues">
          <h4>Issues identified</h4>
          <ul>{f.issues.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      )}
      {d.evaluator_finance.note && <p className="ev-note"><strong>Evaluator note: </strong>{d.evaluator_finance.note}</p>}
    </div>
  );
}

/** Eligibility: the ten tests with what the data showed, then the assessor's reasons. */
export function EligibilityPanel({ d }: { d: EvalDetail }) {
  return (
    <div className="ev-panel">
      <div className="ev-tests">
        {d.eligibility_tests.map((t) => (
          <div key={t.test} className="ev-test">
            <div className="ev-test-head">
              <strong>{t.test}</strong>
              <span>{t.label}</span>
              <StatusChip value={t.decision} empty="Pending" />
            </div>
            {t.hint && <p className="ev-hint"><em>Data check</em>{t.hint}</p>}
            {t.note ? <p className="ev-assessor"><em>Assessor's note</em>{t.note}</p> : !t.hint && <p className="ev-hint">Nothing recorded.</p>}
          </div>
        ))}
      </div>
      <div className="ev-result"><span>Eligibility status</span><StatusChip value={d.eligibility} /></div>
      {d.assessment.eligibility_assessor && <p className="ev-note"><strong>Assessed by: </strong>{d.assessment.eligibility_assessor}{d.assessment.eligibility_assessed_on ? ` · ${d.assessment.eligibility_assessed_on}` : ''}</p>}
      {d.evidence_files && (
        <details className="eval-evidence">
          <summary><span>Evidence files</span></summary>
          <p>{d.evidence_files}</p>
        </details>
      )}
    </div>
  );
}

/** Scorecard: six weighted criteria, their sub-indicator ratings and the written justification. */
export function ScorePanel({ d }: { d: EvalDetail }) {
  const a = d.assessment;
  return (
    <div className="ev-panel">
      <div className="ev-signoff">
        <span><em>Primary assessor</em>{a.assessor ?? 'Not recorded'}{a.assessed_on ? ` · ${a.assessed_on}` : ''}</span>
        <span><em>Expert reviewer</em>{a.reviewer ?? 'Not yet reviewed'}{a.reviewed_on ? ` · ${a.reviewed_on}` : ''}</span>
      </div>
      <div className="eval-criteria">
        {d.criteria.map((k) => (
          <details key={k.code} className="eval-evidence">
            <summary>
              <span>{k.code}: {k.label} <small className="text-muted-foreground">weight {k.weight}</small></span>
              <strong>{k.score ?? '-'} / {k.weight}</strong>
            </summary>
            <div className="ev-inds">
              {k.indicators.map((i) => (
                <div key={i.code} className="ev-ind-card">
                  <div className="ev-ind-head">
                    <strong>{i.code}</strong>
                    <span>{i.label}</span>
                    <small>{i.weight}%</small>
                    <span className="ev-ind-rating"><b className={`rating tone-${i.rating == null ? 'neutral' : i.rating >= 4 ? 'good' : i.rating >= 3 ? 'warn' : 'bad'}`}>{i.rating ?? '-'}</b> / 5</span>
                  </div>
                  {i.note && <p>{i.note}</p>}
                </div>
              ))}
              {!k.indicators.some((i) => i.note) && <p className="ev-assessor">{k.justification ?? 'No justification recorded.'}</p>}
            </div>
          </details>
        ))}
      </div>
      <div className="ev-issues">
        <h4>Expert review</h4>
        {d.expert_remarks ? <p>{d.expert_remarks}</p> : null}
      </div>
    </div>
  );
}

/** Score, band and ranks at a glance. */
export function ScoreHero({ d }: { d: EvalDetail }) {
  const score = d.score != null ? Math.round(d.score * 10) / 10 : null;
  return (
    <div className="eval-hero">
      <div>
        <div className="eval-big">{score ?? '-'}<small> / 100</small></div>
        <div style={{ marginTop: 8 }}><BandChip band={d.band} score={d.score} /></div>
      </div>
      <div className="eval-facts">
        <div><strong>{d.rank != null ? `#${d.rank} of ${d.eligible_clusters}` : 'Not ranked'}</strong><span>Among eligible clusters</span></div>
        <div><strong>{d.county_rank != null ? `#${d.county_rank}` : 'Not ranked'}</strong><span>In {d.county}</span></div>
      </div>
      <div className="eval-gates">
        <StatusChip value={d.eligibility} empty="Eligibility pending" />
        <StatusChip value={d.financial.result} />
        <ScoreBar score={d.score} compact />
      </div>
    </div>
  );
}

