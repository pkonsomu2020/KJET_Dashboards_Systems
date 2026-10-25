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

/** Financial screening: the 50-50 checks, worked out from the application figures on Drive. */
export function FinancialPanel({ d }: { d: EvalDetail }) {
  const f = d.financial_detail;
  const c = f.checks;
  return (
    <div className="ev-panel">
      <div className="ev-cols">
        <div>
          <h4>Figures (application on Drive)</h4>
          <Row label="Total project cost" value={kes(f.figures.total)} />
          <Row label="KJET grant requested" value={kes(f.figures.grant)} />
          <Row label="Cluster contribution" value={kes(f.figures.contribution)} />
          <Row label="Machinery subtotal" value={kes(f.figures.machinery)} />
          <Row label="Services subtotal" value={kes(f.figures.services)} />
        </div>
        <div>
          <h4>50-50 rule and category</h4>
          <Row label="Category (by grant requested)" value={f.category} />
          <Row label="Cluster share of total" value={pct(c.cluster_share)} tone={c.meets_50_percent_cash === false ? 'bad' : undefined} />
          <Row label="KJET share of total" value={pct(c.kjet_share)} />
          <Row label="Meets 50% cash contribution" value={yn(c.meets_50_percent_cash)} tone={c.meets_50_percent_cash === false ? 'bad' : c.meets_50_percent_cash ? 'good' : undefined} />
          <Row label="Maximum eligible grant" value={kes(c.max_eligible_grant)} />
          <Row label="Grant above eligible maximum" value={kes(c.grant_above_max)} tone={c.grant_above_max && c.grant_above_max > 100 ? 'warn' : undefined} />
          <Row label="Minimum cluster cash" value={kes(c.min_cluster_cash)} />
          <Row label="Contribution shortfall" value={kes(c.contribution_shortfall)} tone={c.contribution_shortfall ? 'bad' : undefined} />
        </div>
        <div>
          <h4>Arithmetic and documents</h4>
          <Row label="Contribution plus grant" value={kes(c.contribution_plus_grant)} />
          <Row label="Total minus (contribution plus grant)" value={kes(c.total_minus_contribution_and_grant)} />
          <Row label="Total minus (machinery plus services)" value={kes(c.total_minus_machinery_and_services)} />
          <Row label="Arithmetic consistent" value={yn(c.arithmetic_consistent)} tone={c.arithmetic_consistent === false ? 'bad' : undefined} />
          <Row label="Placeholder amounts" value={yn(c.implausible_amounts)} />
          <Row label="Category document check" value={c.document_check ?? 'Not stated'} tone={c.document_check?.startsWith('Missing') ? 'warn' : undefined} />
        </div>
      </div>
      <div className="ev-result"><span>Screening result</span><StatusChip value={f.result} /></div>
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
            <p>{t.hint ?? 'Nothing recorded.'}</p>
          </div>
        ))}
      </div>
      <div className="ev-result"><span>Eligibility status</span><StatusChip value={d.eligibility} /></div>
      {d.eligibility_reasons && (
        <details className="eval-evidence">
          <summary><span>Assessment notes and evidence</span></summary>
          <p>{d.eligibility_reasons.replace(/\s(E(?:10|[1-9]) \((?:Pass|Hold|Fail)\):)/g, '\n$1')}</p>
          {d.evidence_files && <p><strong>Evidence files: </strong>{d.evidence_files}</p>}
        </details>
      )}
    </div>
  );
}

/** Scorecard: six weighted criteria, their sub-indicator ratings and the written justification. */
export function ScorePanel({ d }: { d: EvalDetail }) {
  return (
    <div className="ev-panel">
      <div className="eval-criteria">
        {d.criteria.map((k) => (
          <details key={k.code} className="eval-evidence">
            <summary>
              <span>{k.code}: {k.label} <small className="text-muted-foreground">weight {k.weight}</small></span>
              <strong>{k.score ?? '-'} / {k.weight}</strong>
            </summary>
            <table className="ev-ind">
              <tbody>
                {k.indicators.map((i) => (
                  <tr key={i.code}>
                    <td>{i.code}</td>
                    <td>{i.label}</td>
                    <td className="ev-w">{i.weight}%</td>
                    <td className="ev-r"><span className={`rating tone-${i.rating == null ? 'neutral' : i.rating >= 4 ? 'good' : i.rating >= 3 ? 'warn' : 'bad'}`}>{i.rating ?? '-'}</span> / 5</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>{k.justification ? k.justification.replace(/\s(C[1-6]\.\d \(\d\):)/g, '\n$1') : 'No justification recorded.'}</p>
          </details>
        ))}
      </div>
      {(d.expert_remarks || d.moderation_note) && (
        <div className="ev-issues">
          <h4>Expert review</h4>
          {d.expert_remarks && <p>{d.expert_remarks}</p>}
          {d.moderation_note && <p className="ev-note"><strong>Moderation note: </strong>{d.moderation_note}</p>}
        </div>
      )}
    </div>
  );
}

/** Score, band, ranks and grant-ready status at a glance. */
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
        <div><strong>{d.grant_ready ? `#${d.grant_ready_rank}` : 'No'}</strong><span>Grant-ready</span></div>
      </div>
      <div className="eval-gates">
        <StatusChip value={d.eligibility} empty="Eligibility pending" />
        <StatusChip value={d.financial.result} />
        <ScoreBar score={d.score} compact />
      </div>
    </div>
  );
}

