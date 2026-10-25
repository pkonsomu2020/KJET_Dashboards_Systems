import { useState } from 'react';
import { FileDown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { downloadEvaluationReport, downloadEvaluationReports } from '@/data/api';

/** Downloads one cluster's evaluation report as a PDF. */
export function ReportButton({ applicationNumber, clusterName, label, size = 'icon' }: {
  applicationNumber: string; clusterName: string; label?: string; size?: 'icon' | 'sm';
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const run = async () => {
    setBusy(true);
    setFailed(false);
    try { await downloadEvaluationReport(applicationNumber); } catch { setFailed(true); } finally { setBusy(false); }
  };
  const title = failed ? 'The report could not be created. Try again.' : `Download the evaluation report of ${clusterName} (PDF)`;
  return (
    <Button type="button" variant={size === 'icon' ? 'ghost' : 'outline'} size={size} disabled={busy} onClick={run}
      aria-label={`Download evaluation report of ${clusterName}`} title={title} className={failed ? 'report-failed' : ''}>
      {busy ? <Loader2 className="animate-spin" /> : <FileDown className={size === 'icon' ? 'text-primary' : ''} />}
      {label}
    </Button>
  );
}

/** Downloads the reports of all evaluated clusters in one zip. */
export function ReportsZipButton({ label }: { label: string }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const run = async () => {
    setBusy(true);
    setFailed(false);
    try { await downloadEvaluationReports(); } catch { setFailed(true); } finally { setBusy(false); }
  };
  return (
    <Button type="button" variant="outline" size="sm" disabled={busy} onClick={run}
      title={failed ? 'The reports could not be created. Try again.' : 'One PDF per cluster, in a zip file'}>
      {busy ? <Loader2 className="animate-spin" /> : <FileDown />}{failed ? 'Try again' : label}
    </Button>
  );
}
