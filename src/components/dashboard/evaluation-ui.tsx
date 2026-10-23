import { AlertTriangle, CheckCircle2, CircleDashed, XCircle } from 'lucide-react';

/** The six weighted criteria of the evaluation scorecard (weights add up to 100). */
export const CRITERIA = [
  { key: 'c1', label: 'Overall cluster performance and viability', weight: 20 },
  { key: 'c2', label: 'Machinery investment viability', weight: 40 },
  { key: 'c3', label: 'Implementation capacity', weight: 15 },
  { key: 'c4', label: 'Relevant past experience', weight: 10 },
  { key: 'c5', label: 'Leadership and management experience', weight: 10 },
  { key: 'c6', label: 'Women or youth ownership and operation', weight: 5 },
] as const;

export type Tone = 'good' | 'warn' | 'bad' | 'neutral';

/** Colour role of a gate value from the evaluation workbook (PASS, FOLLOW-UP: ..., Not eligible, ...). */
export function gateTone(value: string | null | undefined): Tone {
  const v = (value ?? '').trim().toLowerCase();
  if (!v) return 'neutral';
  if (/^(fail|non-compliant|not eligible|not recommended|rejected)/.test(v)) return 'bad';
  if (/^(pass|ready|recommended|cleared|no exclusion|verified|complete)/.test(v)) return 'good';
  if (/^(follow-up|clarify|hold|in progress|gaps|pending|referred|deferred)/.test(v)) return 'warn';
  return 'neutral';
}

/** Band colour from the score rule: 70 or more recommended, 50 to 69 referred, below 50 rejected. */
export function scoreTone(score: number | string | null | undefined): Tone {
  const n = Number(score);
  if (score == null || score === '' || !Number.isFinite(n)) return 'neutral';
  return n >= 70 ? 'good' : n >= 50 ? 'warn' : 'bad';
}

const ICON = { good: CheckCircle2, warn: AlertTriangle, bad: XCircle, neutral: CircleDashed } as const;

export function GateChip({ label, value, empty = 'Pending' }: { label: string; value: string | null | undefined; empty?: string }) {
  const tone = gateTone(value);
  const Icon = ICON[tone];
  const shown = (value ?? '').trim() || empty;
  return (
    <span className={`gate-chip tone-${tone}`} title={`${label}: ${shown}`}>
      <Icon size={11} aria-hidden="true" />
      <span className="gate-label">{label}</span>
      <span className="gate-value">{shown.length > 26 ? `${shown.slice(0, 24)}...` : shown}</span>
    </span>
  );
}

export function BandChip({ band, score }: { band: string | null | undefined; score?: number | string | null }) {
  const tone = band ? gateTone(band === 'Referred with Comments' ? 'referred' : band) : scoreTone(score);
  return <span className={`band-chip tone-${tone}`}>{band ?? 'Not scored'}</span>;
}

/** Score out of 100 as a number and a solid bar. */
export function ScoreBar({ score, compact = false }: { score: number | string | null | undefined; compact?: boolean }) {
  const n = Number(score);
  const valid = score != null && score !== '' && Number.isFinite(n);
  const tone = scoreTone(score);
  return (
    <div className={`score-bar ${compact ? 'compact' : ''}`} role="img" aria-label={valid ? `Score ${n} out of 100` : 'Not scored'}>
      <strong>{valid ? Math.round(n * 10) / 10 : '-'}</strong>
      <span className="score-track">
        <i className={`tone-${tone}`} style={{ width: `${valid ? Math.max(2, Math.min(100, n)) : 0}%` }} />
      </span>
    </div>
  );
}
