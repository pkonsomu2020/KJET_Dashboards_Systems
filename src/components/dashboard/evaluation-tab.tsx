import { money } from '@/data/portfolio';
import type { ClusterDetail } from '@/data/api';
import { BandChip, CRITERIA, GateChip, scoreTone } from './evaluation-ui';

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="detail-label">{label}</div>
      <div className="detail-value">{value && String(value).trim() ? value : 'Not stated'}</div>
    </div>
  );
}

const amount = (v: string | number | null | undefined) => (v == null || v === '' ? null : money(Number(v), false));

export function EvaluationTab({ cluster: c }: { cluster: ClusterDetail }) {
  const e = c.evaluation;
  if (!e) {
    return (
      <section className="profile-section">
        <h3>Evaluation</h3>
        <p>This cluster has no evaluation results yet. Scores appear here once the evaluation workbook has been loaded.</p>
      </section>
    );
  }

  const score = Number(e.total_score);

  return (
    <>
      <div className="eval-hero">
        <div>
          <div className="eval-big">{Number.isFinite(score) ? Math.round(score * 10) / 10 : '-'}<small> / 100</small></div>
          <div style={{ marginTop: 8 }}><BandChip band={e.band} score={e.total_score} /></div>
        </div>
        <div className="eval-facts">
          <div><strong>{e.shortlisted ? `#${e.shortlist_rank}` : 'Not listed'}</strong><span>Grant-ready list</span></div>
          <div><strong>{e.rank != null ? `#${e.rank}` : 'Not ranked'}</strong><span>Overall rank</span></div>
          <div><strong>{e.county_rank != null ? `#${e.county_rank}` : 'Not ranked'}</strong><span>In {c.county}</span></div>
        </div>
      </div>

      {e.shortlisted && e.shortlist_reason && (
        <section className="profile-section">
          <h3>Why this cluster is on the grant-ready list</h3>
          <p>{e.shortlist_reason}</p>
        </section>
      )}

      <section className="profile-section">
        <h3>Score by criterion</h3>
        <div className="eval-criteria">
          {CRITERIA.map((k) => {
            const pts = Number((e as unknown as Record<string, unknown>)[`${k.key}_score`]);
            const rating = (e as unknown as Record<string, unknown>)[`${k.key}_rating`];
            const pct = Number.isFinite(pts) ? (pts / k.weight) * 100 : 0;
            return (
              <div className="eval-crit" key={k.key}>
                <span className="name">{k.label}<small>rated {rating != null && rating !== '' ? `${Number(rating)} / 5` : 'n/a'}</small></span>
                <span className="pts">{Number.isFinite(pts) ? Math.round(pts * 10) / 10 : '-'} / {k.weight}</span>
                <span className="score-track"><i className={`tone-${scoreTone(pct)}`} style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} /></span>
              </div>
            );
          })}
        </div>
        <p style={{ marginTop: 14 }}>Each criterion is rated 0 to 5 by the assessors and weighted to its share of the 100 points. 70 or more is Recommended, 50 to 69 is Referred with comments, and below 50 is Rejected.</p>
      </section>

      <section className="profile-section">
        <h3>Screening results</h3>
        <div className="eval-gates">
          <GateChip label="Eligibility" value={e.eligibility} />
          <GateChip label="Financial screening" value={e.financial_screening} />
          <GateChip label="Data readiness" value={e.data_readiness} />
          <GateChip label="Due diligence" value={e.due_diligence} />
          <GateChip label="Exclusion" value={e.exclusion_status} empty="Not assessed" />
          <GateChip label="E&S" value={e.es_disposition} empty="Not assessed" />
        </div>
      </section>


      <section className="profile-section">
        <h3>Figures (application on Drive)</h3>
        <div className="detail-grid">
          <Field label="Project cost" value={amount(c.total_project_cost)} />
          <Field label="Grant requested" value={amount(c.grant_requested)} />
          <Field label="Cluster contribution" value={amount(c.cluster_contribution)} />
        </div>
      </section>

      <section className="profile-section">
        <h3>Assessor justification</h3>
        {CRITERIA.map((k) => {
          const text = (e as unknown as Record<string, unknown>)[`${k.key}_evidence`];
          return (
            <details className="eval-evidence" key={k.key}>
              <summary><span>{k.key.toUpperCase()}: {k.label}</span></summary>
              <p>{typeof text === 'string' && text.trim() ? text : 'No justification recorded.'}</p>
            </details>
          );
        })}
      </section>

      <p className="gr-foot">Source: {e.source_file ?? 'evaluation workbook'}. Scores and decisions come from the evaluation workbook; amounts come from the application on Drive.</p>
    </>
  );
}
