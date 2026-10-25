import { Loader2 } from 'lucide-react';
import { useEvaluationDetail } from '@/hooks/usePortfolio';
import { EligibilityPanel, FinancialPanel, ScoreHero, ScorePanel } from './evaluation-panels';
import { ReportButton } from './report-buttons';

/** The profile's Evaluation tab: score, financial screening, eligibility and scorecard of one cluster. */
export function EvaluationTab({ applicationNumber }: { applicationNumber: string }) {
  const { data: d, isLoading } = useEvaluationDetail(applicationNumber);

  if (isLoading) {
    return <div className="ev-loading"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>;
  }
  if (!d) {
    return (
      <section className="profile-section">
        <h3>Evaluation</h3>
        <p>This cluster has no evaluation results yet. They appear here as soon as it is scored in the evaluation sheet.</p>
      </section>
    );
  }

  return (
    <>
      <ScoreHero d={d} />
      <div className="ev-actions">
        <ReportButton applicationNumber={d.application_number} clusterName={d.cluster_name} label="Download report (PDF)" />
      </div>

      <section className="profile-section">
        <h3>Financial screening</h3>
        <FinancialPanel d={d} />
      </section>

      <section className="profile-section">
        <h3>Eligibility (E1 to E10)</h3>
        <EligibilityPanel d={d} />
      </section>

      <section className="profile-section">
        <h3>Scoring (evaluation criteria)</h3>
        <ScorePanel d={d} />
      </section>

      <p className="gr-foot">Scores and findings come from the evaluation sheet; amounts and the 50-50 checks are worked out from the application on Drive. Recommended clusters are provisionally recommended: they remain subject to review by the Independent Evaluation Technical Panel (IETP), onsite verification and approval for financing by the MSEA Director General/CEO.</p>
    </>
  );
}
