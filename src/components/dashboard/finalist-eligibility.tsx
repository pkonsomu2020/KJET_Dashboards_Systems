import { AlertTriangle, CheckCircle2, CircleDashed } from 'lucide-react';
import type { FinalistDetail, FinalistRules } from '@/data/api';
import { GateChip } from './evaluation-ui';

type Tone = 'good' | 'warn' | 'neutral';
type Check = { tone: Tone; text: string };

const norm = (s: string | null | undefined) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const digits = (s: string | null | undefined) => String(s ?? '').replace(/\D/g, '');
const answer = (d: FinalistDetail, re: RegExp) => d.questions.find((q) => re.test(q.question))?.answer.trim() ?? '';
/** A registration number, without the words people write around it ("CS/No: 5114", "NO. ASS RA-5OTMA8") and without leading zeros. */
const regCore = (s: string | null | undefined) => norm(String(s ?? '').replace(/\b(no|number|reg|regn|certificate|cert)\b\.?:?/gi, ' ')).replace(/^0+/, '');

/** The kind of financial evidence the sheet recorded for E4 in Cohort 1, as the document type it would be filed under. */
const EVIDENCE_TYPES: Array<[RegExp, string]> = [
  [/bank/i, 'Bank statements'],
  [/m-?pesa/i, 'M-Pesa statements'],
  [/income|profit/i, 'Income statements'],
  [/balance/i, 'Balance sheets'],
  [/cash ?-?flow/i, 'Cash-flow statements'],
  [/book|receipt|ledger|cogs|stock/i, 'Books and receipts'],
];

function sameAsForm(recorded: string | null, form: string, loose = false, core: (s: string | null) => string = norm): Check {
  if (!recorded) return { tone: 'neutral', text: 'Nothing was recorded in the spreadsheet' };
  if (!form) return { tone: 'neutral', text: 'Not found in the application form' };
  const a = core(recorded), b = core(form);
  const same = a === b || (loose && !!a && !!b && (a.includes(b) || b.includes(a)));
  return same ? { tone: 'good', text: 'Same as in the application form' } : { tone: 'warn', text: `The application form says: ${form}` };
}

const verdict = (note: string | null): 'yes' | 'no' | null => (/^\s*yes\b/i.test(note ?? '') ? 'yes' : /^\s*no\b/i.test(note ?? '') ? 'no' : null);

function checksOf(d: FinalistDetail): Check[] {
  const formOk = d.form_status === 'ok';
  const noForm: Check = { tone: 'neutral', text: 'The application form is not available to compare' };
  const e1 = formOk ? sameAsForm(d.checks.e1, answer(d, /^What is your registration number/i), true, regCore) : noForm;
  const e2 = formOk ? sameAsForm(d.county, answer(d, /^Which county/i)) : noForm;
  const e3 = formOk ? sameAsForm(d.checks.e3, answer(d, /^(What is your value chain|Which value chain)/i), true) : noForm;
  const financialDocs = d.documents.financial_types.length ? `Financial documents on file: ${d.documents.financial_types.join(', ')}.` : formOk ? 'No financial documents were found in the folder.' : '';

  if (d.cohort === 2) {
    // Cohort 2: E4 and E5 are the evaluator's own notes ("yes-bank statement attached", "no-handwritten financial book", a phone number)
    const v4 = verdict(d.checks.e4);
    const e4: Check = !d.checks.e4
      ? { tone: 'neutral', text: 'Nothing was recorded in the spreadsheet' }
      : v4 === 'no' ? { tone: 'warn', text: `The evaluator's note says no. ${financialDocs}`.trim() }
        : v4 === 'yes' ? { tone: 'good', text: `The evaluator's note says yes. ${financialDocs}`.trim() }
          : { tone: 'neutral', text: financialDocs || "See the evaluator's note" };
    const note5 = d.checks.e5 ?? '';
    const v5 = verdict(note5);
    const sheetPhone = digits(d.contact?.phone);
    const e5: Check = !note5
      ? { tone: 'neutral', text: 'Nothing was recorded in the spreadsheet' }
      : digits(note5).length >= 9
        ? (sheetPhone ? (digits(note5).slice(-9) === sheetPhone.slice(-9) ? { tone: 'good', text: 'Same phone number as in the contact list' } : { tone: 'warn', text: `The contact list says: ${d.contact?.phone}` }) : { tone: 'neutral', text: 'A phone number was recorded' })
        : v5 === 'yes' ? { tone: 'good', text: "The evaluator's note says yes" } : v5 === 'no' ? { tone: 'warn', text: "The evaluator's note says no" } : { tone: 'neutral', text: "See the evaluator's note" };
    return [e1, e2, e3, e4, e5];
  }

  // Cohort 1: E4 is the kind of evidence, E5 the phone number
  const phone = digits(answer(d, /^What is your phone number/i));
  const recordedPhone = digits(d.checks.e5);
  const evidence = d.checks.e4 ?? '';
  const type = EVIDENCE_TYPES.find(([re]) => re.test(evidence))?.[1] ?? null;
  const onFile = type ? d.documents_list.filter((x) => x.type === type).length : 0;
  return [
    e1, e2, e3,
    !evidence
      ? { tone: 'neutral', text: 'Nothing was recorded in the spreadsheet' }
      : !type
        ? { tone: 'neutral', text: `${d.documents_list.filter((x) => x.type !== 'Application form').length} documents on file` }
        : onFile > 0
          ? { tone: 'good', text: `${type}: ${onFile} on file` }
          : { tone: 'warn', text: `No ${type.toLowerCase()} found in the finalist's folder` },
    !d.checks.e5
      ? { tone: 'neutral', text: 'Nothing was recorded in the spreadsheet' }
      : !phone
        ? { tone: 'neutral', text: formOk ? 'No phone number in the application form' : 'The application form is not available to compare' }
        : phone.slice(-9) === recordedPhone.slice(-9)
          ? { tone: 'good', text: 'Same phone number as in the application form' }
          : { tone: 'warn', text: `The application form says: ${answer(d, /^What is your phone number/i)}` },
  ];
}

const TESTS = [
  { code: 'E1', name: 'Registration and legality', looksAt: 'Whether the cluster is legally registered. The registration number is recorded.' },
  { code: 'E2', name: 'County mapping', looksAt: 'Whether the cluster really is in the county it applied from.' },
  { code: 'E3', name: 'Priority value chain', looksAt: "Whether the cluster works in one of KJET's priority value chains." },
  { code: 'E4', name: 'Minimum financial evidence', looksAt: 'Whether the cluster supplied the minimum financial evidence. What was provided is recorded.' },
  { code: 'E5', name: 'Consent and contactability', looksAt: 'Whether the cluster agreed to take part and can be reached.' },
] as const;

const ICON = { good: CheckCircle2, warn: AlertTriangle, neutral: CircleDashed } as const;

export function EligibilityTab({ d, rules }: { d: FinalistDetail; rules: FinalistRules | undefined }) {
  const c2 = d.cohort === 2;
  const passed = /^pass/i.test(d.result ?? '');
  const checks = checksOf(d);
  const recorded = [d.checks.e1, d.checks.e2, d.checks.e3 && d.other_value_chain && /^other$/i.test(d.checks.e3) ? `${d.checks.e3}: ${d.other_value_chain}` : d.checks.e3, d.checks.e4, d.checks.e5];
  const agree = checks.filter((c) => c.tone === 'good').length;
  const differ = checks.filter((c) => c.tone === 'warn').length;
  const [ruleHeading, ...ruleLines] = rules?.eligibility ?? [];
  const financialDocs = Object.entries(d.documents.by_type).filter(([t]) => d.documents.financial_types.includes(t));
  const name = d.cluster_name ?? 'This finalist';

  return (
    <>
      <section className="profile-section">
        <h3>Result</h3>
        <div className="fn-result">
          {c2
            ? <span className="gate-chip tone-good"><CheckCircle2 size={12} aria-hidden="true" />Listed in the Selected tab</span>
            : <GateChip label="Eligibility" value={d.result} />}
          <p>
            {c2
              ? `${name} is listed in the Selected tab of the Cohort 2 spreadsheet, which the sheet describes as the top 6 applicants in each county who met the eligibility criteria. The tab has no separate Pass or Fail column: what the evaluator recorded for each test is below.`
              : passed
                ? `${name} passed the eligibility tests (E1 to E5), so it went on to be scored. Only applicants who pass are scored and can become finalists.`
                : `${name} did not pass the eligibility tests (E1 to E5). The sheet excludes such applicants from scoring.`}
          </p>
        </div>
        {d.reason && <div className="app-para"><div className="detail-label">Evaluator's reason</div><p className="fn-answer">{d.reason}</p></div>}
        <div className="detail-grid">
          <div><div className="detail-label">Decision recorded</div><div className="detail-value">{c2 ? 'Listed in the Selected tab' : d.result ?? 'Not recorded'}</div></div>
          {d.evaluator && <div><div className="detail-label">Evaluator</div><div className="detail-value">{d.evaluator}</div></div>}
        </div>
        {ruleLines.length > 0 && (
          <div className="fn-rule">
            <strong>{ruleHeading ?? 'How eligibility is decided'}</strong>
            <ul>{ruleLines.map((l) => <li key={l}>{l}</li>)}</ul>
            <small>As written in the spreadsheet.</small>
          </div>
        )}
      </section>

      <section className="profile-section">
        <h3>The five tests</h3>
        <p className="fn-note">
          {c2
            ? "The spreadsheet records what the evaluator checked in each test; E4 and E5 are the evaluator's own notes. The last column compares each recorded value with the application form, the contact list and the documents on file: "
            : 'The spreadsheet records one decision for the five tests together, plus what was checked in each. The last column compares each recorded value with the application form and the documents on file: '}
          <strong>{agree} of 5</strong> agree{differ ? `, ${differ} differ` : ''}.
        </p>
        <div className="app-table-wrap">
          <table className="portfolio-table app-table fn-tests">
            <thead><tr><th>Test</th><th>What it looks at</th><th>Recorded in the spreadsheet</th><th>Cross-check</th></tr></thead>
            <tbody>
              {TESTS.map((t, i) => {
                const c = checks[i]!;
                const Icon = ICON[c.tone];
                return (
                  <tr key={t.code}>
                    <td><strong>{t.code}</strong> {t.name}</td>
                    <td className="fn-logic">{t.looksAt}</td>
                    <td className="fn-logic"><strong>{recorded[i] ?? '-'}</strong></td>
                    <td className="fn-logic"><span className={`fn-check tone-${c.tone}`}><Icon size={12} aria-hidden="true" />{c.text}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="profile-section">
        <h3>Financial evidence on file</h3>
        <div className="detail-grid">
          <Row label={c2 ? "Evaluator's note on E4" : 'Evidence recorded for E4'} value={d.checks.e4} />
          <Row label="Financial documents in the folder" value={d.form_status !== 'ok' ? 'The folder is not shown (see the Documents tab)' : financialDocs.length ? financialDocs.map(([t, n]) => `${t}: ${n}`).join(' · ') : 'None found'} />
        </div>
        {(rules?.financial_evidence ?? []).length > 0 && (
          <div className="fn-rule">
            <strong>What the sheet accepts as financial evidence</strong>
            <ul>{rules!.financial_evidence.filter((l) => !/^Evidence Box/i.test(l)).map((l) => <li key={l}>{l.replace(/^Accept:\s*/i, '')}</li>)}</ul>
            <small>As written in the spreadsheet. The documents themselves are on the Documents tab.</small>
          </div>
        )}
      </section>

      <section className="profile-section">
        <h3>Disqualifiers and penalties</h3>
        <div className="detail-grid">
          <Row label="Disqualifier recorded" value={d.disqualifier ?? 'None'} />
          <Row label="Penalty points" value={d.penalty == null ? 'Not recorded' : String(d.penalty)} />
        </div>
        {(rules?.disqualifiers ?? []).length > 0 && (
          <div className="fn-rule">
            <strong>The rules in the spreadsheet</strong>
            <ul>{rules!.disqualifiers.map((l) => <li key={l}>{l}</li>)}</ul>
          </div>
        )}
      </section>
    </>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return <div><div className="detail-label">{label}</div><div className="detail-value">{value || 'Not recorded'}</div></div>;
}
