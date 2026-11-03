import { useMemo } from 'react';
import { Award, Building2, ExternalLink, FileText, FolderOpen, Info, Loader2, MapPin, Sheet as SheetIcon, ShieldCheck, TriangleAlert, Users } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { BarChart, Bar, CartesianGrid, Legend, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { number } from '@/data/portfolio';
import { useFinalistDetail } from '@/hooks/usePortfolio';
import { finalistDocumentUrl, type FinalistDetail, type FinalistRules } from '@/data/api';
import { EligibilityTab } from './finalist-eligibility';

const FINANCE_NOTE = 'Application form answers are as the clusters stated them. The finance questions of the form (turnover or revenue, profit and price-cost margins) are left out: money is judged from the attached documents only.';
const tooltipStyle = { background: 'var(--card)', borderColor: 'var(--border)', borderRadius: 6 };
const chain = (v: string | null | undefined) => (v ?? '').replace(/_/g, ' ');
/** The contact list writes places in lower case with underscores ("eldama_ravine"): shown as names. Anything already capitalised is left as it is. */
const place = (v: string | null | undefined) => { const t = chain(v); return t && t === t.toLowerCase() ? t.replace(/\b\w/g, (c) => c.toUpperCase()) : t; };
const sentence = (v: string | null | undefined) => (v ? v.charAt(0).toUpperCase() + v.slice(1) : v);
const num = (v: number | null | undefined, digits = 0) => (v == null ? '-' : v.toLocaleString('en-KE', { maximumFractionDigits: digits }));
const size = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

type Q = FinalistDetail['questions'][number];

function Detail({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div>
      <div className="detail-label">{label}</div>
      <div className="detail-value">{value === 0 || value ? value : 'Not supplied'}</div>
    </div>
  );
}

// Plain field names for the form's questions, so the Overview reads as a record and not as a questionnaire
const LABELS: Array<[RegExp, string]> = [
  [/alternate phone/i, 'Alternate phone number'],
  [/phone number/i, 'Phone number'],
  [/email/i, 'Email address'],
  [/chairperson/i, 'Chairperson'],
  [/secretary/i, 'Secretary'],
  [/\bCEO\b/, 'CEO'],
  [/director/i, 'Director'],
  [/manager/i, 'Manager'],
  [/treasurer/i, 'Treasurer'],
  [/place of operation \(other\)/i, 'Place of operation (other)'],
  [/name of the place of operation|specify your place of operation/i, 'Name of the place of operation'],
  [/where is your place of operation/i, 'Place of operation'],
  [/name of your operation/i, 'Name of the operation'],
  [/your location|nearest landmark/i, 'Location and nearest landmark'],
  [/explain how your enterprise meets|describe how it meets the women-owned/i, 'How the enterprise meets the women-owned criteria'],
  [/is this a women-owned enterprise/i, 'Women-owned enterprise'],
  [/registration status \(other\)|specify your registration status/i, 'Registration status (other)'],
  [/what is your registration number/i, 'Registration number'],
  [/year was your cluster/i, 'Year established'],
  [/which county are you located in/i, 'County'],
  [/which value chain do you operate in/i, 'Value chain'],
  [/accounting package or system/i, 'Accounting package or system'],
  [/specify the accounting package|other accounting package/i, 'Accounting package (other)'],
  [/accounting package\?/i, 'Uses an accounting package'],
  [/e-commerce or digital channels/i, 'Uses e-commerce or digital channels'],
  [/percentage of your sales are B2B/i, 'Share of sales that are B2B'],
  [/percentage of your sales are B2C/i, 'Share of sales that are B2C'],
  [/percentage of your sales are exports/i, 'Share of sales that are exports'],
];
const plainLabel = (q: string) => {
  const hit = LABELS.find(([re]) => re.test(q));
  if (hit) return hit[1];
  const t = q.replace(/[?:]+$/, '').replace(/^(what|which|who|where|how many)\s+(is|are|was)?\s*(your|the)?\s*/i, '').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : q;
};

/** Short answers sit in a grid; long ones get a card of their own. */
const isShort = (a: string) => a.length <= 70 && !a.includes('\n');

/** Lays an answer out as paragraphs and bullet lists: lines that start with a dash, a bullet or a number become list items. */
function FormattedAnswer({ text }: { text: string }) {
  const blocks: Array<{ list: boolean; lines: string[] }> = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) { blocks.push({ list: false, lines: [] }); continue; }
    const item = /^([-–•*]\s*|\d+[.)]\s+)(.+)$/.exec(line);
    const last = blocks[blocks.length - 1];
    if (item) {
      if (last?.list) last.lines.push(item[2]!); else blocks.push({ list: true, lines: [item[2]!] });
    } else if (last && !last.list && last.lines.length) last.lines.push(line);
    else blocks.push({ list: false, lines: [line] });
  }
  return (
    <div className="fn-prose">
      {blocks.filter((b) => b.lines.length).map((b, i) => (
        b.list
          ? <ul key={i}>{b.lines.map((l, j) => <li key={j}>{l}</li>)}</ul>
          : <p key={i}>{b.lines.join(' ')}</p>
      ))}
    </div>
  );
}

type Item = { key: string; label: string; value: string };

/** A record: plain labels over values; a long value (an address, a paragraph) takes the full row. */
function Record({ items, empty = 'Nothing was answered in this part of the form.' }: { items: Item[]; empty?: string }) {
  if (items.length === 0) return <p className="fn-note">{empty}</p>;
  return (
    <div className="detail-grid">
      {items.map((it) => (
        <div key={it.key} className={isShort(it.value) ? undefined : 'fn-wide'}>
          <div className="detail-label">{it.label}</div>
          {it.value.includes('\n')
            ? <FormattedAnswer text={it.value} />
            : <div className="detail-value fn-value">{it.value.replace(/^[-–•*]\s*/, '')}</div>}
        </div>
      ))}
    </div>
  );
}

const itemOf = (q: Q): Item => ({ key: `q${q.n}`, label: plainLabel(q.question), value: q.answer.replace(/^[-–•*]\s*(?=[^\n]*$)/, '') });
const present = (q: Q) => q.answer.trim() !== '' && !(/\(other\)|specify your/i.test(q.question) && /^(0|other|n\/a|none)$/i.test(q.answer.trim()));

// A short title for the long questions, so the card does not open with a paragraph of form wording
const TITLES: Array<[RegExp, string]> = [
  [/economic activities and participation/i, 'Economic activities and role in the value chain'],
  [/main economic activities/i, 'Main economic activities'],
  [/clear objectives and performance targets/i, 'Objectives and performance targets'],
  [/business objectives/i, 'Business objectives'],
  [/main competitors/i, 'Main competitors'],
  [/success factors/i, 'Success factors'],
  [/critical equipment|equipment and technology/i, 'Key equipment and technology'],
  [/backward linkages/i, 'Backward linkages: current suppliers'],
  [/marketing plan/i, 'Marketing plan for market expansion'],
  [/problem statement/i, 'Problem statement and BDS support'],
  [/challenges your cluster is currently facing/i, 'Current challenges and BDS support'],
  [/green initiatives or sustainable practices/i, 'Green initiatives and sustainable practices'],
  [/sustainable practices/i, 'Sustainable practices'],
  [/main B2B buyers|B2B Description/i, 'Main B2B buyers'],
  [/main B2C buyers|B2C Description/i, 'Main B2C buyers'],
  [/main export buyers|Exports Description/i, 'Main export buyers'],
  [/woman-owned enterprise/i, 'Women-owned enterprise'],
];
const titleOf = (q: string) => TITLES.find(([re]) => re.test(q))?.[1] ?? (q.split(/[?:.]/)[0] ?? q).trim().slice(0, 80);

function Answers({ questions }: { questions: Q[] }) {
  const shown = questions.filter((q) => q.answer.trim() !== '');
  if (shown.length === 0) return <p className="fn-note">Nothing was answered in this part of the form.</p>;
  const short = shown.filter((q) => isShort(q.answer));
  const long = shown.filter((q) => !isShort(q.answer));
  return (
    <>
      {short.length > 0 && <div className="detail-grid">{short.map((q) => <Detail key={q.n} label={plainLabel(q.question)} value={q.answer} />)}</div>}
      {long.map((q) => (
        <article key={q.n} className="fn-card">
          <header>
            <h4>{titleOf(q.question)}</h4>
            <span>Question {q.n}</span>
          </header>
          <FormattedAnswer text={q.answer} />
          <details className="fn-prompt">
            <summary>Show the question</summary>
            <p>{q.question}</p>
          </details>
        </article>
      ))}
    </>
  );
}

const inRange = (qs: Q[], from: number, to: number) => qs.filter((q) => q.n >= from && q.n <= to);
const inSection = (qs: Q[], section: string) => qs.filter((q) => q.section === section);

/** The Application tab's parts. The Cohort 1 form is a numbered list; the Cohort 2 form has named sections. */
function applicationParts(d: FinalistDetail): Array<{ title: string; questions: Q[] }> {
  const qs = d.questions;
  return d.cohort === 1
    ? [
      { title: 'Value chain', questions: inRange(qs, 36, 38) },
      { title: 'Business', questions: inRange(qs, 39, 52) },
      { title: 'Markets', questions: inRange(qs, 53, 60) },
      { title: 'Challenges and sustainability', questions: inRange(qs, 61, 62) },
    ]
    : !qs.some((q) => q.section === 'Business information')
    // the older numbered form some Cohort 2 finalists (the Cohort 1 alternates) filled in: its sections carry their own names
    ? [
      { title: 'Value chain', questions: inSection(qs, 'Value chain') },
      { title: 'Business', questions: inSection(qs, 'Business') },
      { title: 'Markets', questions: inSection(qs, 'Markets') },
      { title: 'Challenges and sustainability', questions: inSection(qs, 'Challenges and sustainability') },
    ]
    : [
      { title: 'Business', questions: inSection(qs, 'Business information') },
      { title: 'Operations and systems', questions: inSection(qs, 'Business operations and systems') },
      { title: 'Markets', questions: inSection(qs, 'E-commerce and market information') },
      { title: 'Strategy and challenges', questions: inSection(qs, 'Business strategy and challenges') },
    ];
}

/** Contact, officers and where the cluster operates: in the order of the form, found by wording so either form works. */
const CONTACT_ORDER: RegExp[] = [
  /^(what is your phone number|primary phone number)/i, /^(what is your alternate phone|alternate phone number)/i, /^(what is your email|official email)/i,
  /chairperson/i, /secretary/i, /\bCEO\b/, /director/i, /manager/i, /treasurer/i,
  /^where is your place of operation/i, /name of the place of operation|specify your place of operation/i, /^what is the name of your operation/i, /^what is your location/i,
];
function contactItems(d: FinalistDetail): Item[] {
  const items: Item[] = [];
  // Cohort 2: phone and e-mail come from the spreadsheet (they are there for every finalist); the form adds the officers
  if (d.contact) {
    if (d.contact.phone) items.push({ key: 'phone', label: 'Phone number', value: d.contact.phone });
    if (d.contact.alt_phone) items.push({ key: 'alt', label: 'Alternate phone number', value: d.contact.alt_phone });
    if (d.contact.email) items.push({ key: 'email', label: 'Email address', value: d.contact.email });
  }
  CONTACT_ORDER.forEach((re, i) => {
    if (d.contact && i < 3) return;
    const q = d.questions.find((x) => re.test(x.question));
    if (q && present(q)) items.push(itemOf(q));
  });
  return items;
}

/** The finalist's own bundle in Google Drive; only when the sheet gives no (usable) link is the finalist's row of the spreadsheet offered instead. */
function BundleLink({ d }: { d: FinalistDetail }) {
  return d.drive_link ? (
    <a className="fn-link" href={d.drive_link} target="_blank" rel="noreferrer" title={d.drive_file ?? undefined}><FolderOpen size={13} />Open this finalist's bundle in Google Drive<ExternalLink size={11} /></a>
  ) : (
    <a className="fn-link" href={d.sheet_link} target="_blank" rel="noreferrer"><SheetIcon size={13} />Open this finalist's row in the Cohort {d.cohort} spreadsheet<ExternalLink size={11} /></a>
  );
}

/** Says why nothing from the application folder is shown, when its form is not this finalist's own (or there is no folder). */
function FolderNotice({ d }: { d: FinalistDetail }) {
  if (d.form_status === 'ok') return null;
  return (
    <div className="notice fn-notice">
      <TriangleAlert size={16} />
      <div>
        {d.form_status === 'wrong_application'
          ? <><strong>Nothing from this finalist's application folder is shown.</strong> The folder on file holds another cluster's application. {d.form_note}</>
          : <><strong>No application folder was found for this finalist.</strong></>}
        {d.form_status === 'wrong_application' && !d.drive_link && <> The Drive link in the spreadsheet also opens another cluster's bundle, so no Drive link is shown either.</>}
      </div>
    </div>
  );
}

function Profile({ d, rules }: { d: FinalistDetail; rules: FinalistRules | undefined }) {
  const qs = d.questions;
  const c2 = d.cohort === 2;
  const docsByType = useMemo(() => {
    const out = new Map<string, FinalistDetail['documents_list']>();
    for (const x of d.documents_list) out.set(x.type, [...(out.get(x.type) ?? []), x]);
    return [...out.entries()];
  }, [d]);
  const form = d.form;
  const formOk = d.form_status === 'ok';
  const tierText = d.tier ? (rules?.tiers ?? []).find((l) => l.startsWith(d.tier!)) : undefined;
  const years = ['2022', '2023', '2024'];
  const growth = years.map((y) => ({ name: y, Members: form?.members[y] ?? 0, Employees: form?.employees[y] ?? 0 }));
  const sexTotal = (form?.males ?? 0) + (form?.females ?? 0);
  const ageTotal = (form?.age_18_35 ?? 0) + (form?.age_36_50 ?? 0) + (form?.age_over_50 ?? 0);
  const share = (v: number | null | undefined, of: number) => (v == null || !of ? '' : ` (${((v / of) * 100).toFixed(1)}%)`);
  const womenQ = qs.find((q) => /explain how your enterprise meets|describe how it meets the women-owned/i.test(q.question));
  const yearQ = qs.find((q) => /year was your cluster/i.test(q.question));
  const valueChain = d.value_chain && /^other$/i.test(d.value_chain) && d.other_value_chain ? `Other: ${d.other_value_chain}` : chain(d.value_chain);
  const evaluationRows: Array<[string, string | number | null]> = [
    ['Tier', d.tier],
    ['Total', num(d.total, 2)],
    ...(c2 ? [['Equity points', num(d.equity_points, 2)] as [string, string]] : []),
    ['Penalty points', num(d.penalty, 2)],
    [c2 ? 'Composite score (sum of weighted scores, less penalty)' : 'Composite score (total less penalty)', num(d.composite, 2)],
    ['Ranking from composite score', d.rank ?? 'Not given in the sheet'],
    ...(d.rank_in_county != null ? [['Rank in county', d.rank_in_county] as [string, number]] : []),
    ...(d.track_years != null ? [['Years of track record', d.track_years] as [string, number]] : []),
    ...(d.evaluator ? [['Evaluator', d.evaluator] as [string, string]] : []),
  ];

  return (
    <>
      <SheetHeader>
        <div className="badge w-fit">COHORT {d.cohort} FINALIST</div>
        <SheetTitle>{d.cluster_name ?? `Applicant ${d.applicant_id}`}</SheetTitle>
        <SheetDescription>{d.application_id ?? `Applicant ${d.applicant_id}`}</SheetDescription>
      </SheetHeader>

      <div className="profile-meta">
        <span className="badge"><MapPin size={11} />{d.county}{d.constituency ? ` · ${place(d.constituency)}` : ''}</span>
        <span className="badge">{valueChain.length > 34 ? `${valueChain.slice(0, 32)}…` : valueChain}</span>
        {d.result && <span className={`badge ${/^pass/i.test(d.result) ? 'success' : 'warning'}`}><ShieldCheck size={11} />Eligibility {d.result}</span>}
        {d.composite != null && <span className="badge"><Award size={11} />Composite score {num(d.composite, 1)}</span>}
        {d.tier && <span className="badge">{d.tier}</span>}
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="profile-tabs">
          <TabsTrigger value="overview"><Building2 size={13} className="mr-1.5" />Overview</TabsTrigger>
          <TabsTrigger value="eligibility"><ShieldCheck size={13} className="mr-1.5" />Eligibility</TabsTrigger>
          <TabsTrigger value="evaluation"><Award size={13} className="mr-1.5" />Evaluation</TabsTrigger>
          <TabsTrigger value="application"><FileText size={13} className="mr-1.5" />Application</TabsTrigger>
          <TabsTrigger value="membership"><Users size={13} className="mr-1.5" />Membership and jobs</TabsTrigger>
          <TabsTrigger value="documents"><FolderOpen size={13} className="mr-1.5" />Documents</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview">
          <FolderNotice d={d} />
          <section className="profile-section">
            <h3>Registration and location</h3>
            <div className="detail-grid">
              {(formOk || d.registration_status) && <Detail label="Registration status" value={d.registration_status ?? form?.registration_status} />}
              <Detail label="Registration number" value={d.registration_number ?? (qs.find((q) => /what is your registration number/i.test(q.question))?.answer.trim() || null)} />
              {yearQ && yearQ.answer.trim() !== '' && <Detail label="Year established" value={yearQ.answer} />}
              <Detail label="County" value={d.county} />
              <Detail label="Constituency" value={place(d.constituency ?? form?.constituency)} />
              <Detail label="Ward" value={place(d.ward ?? form?.ward)} />
              <Detail label="Value chain" value={valueChain} />
              {formOk && <Detail label="Women-owned enterprise" value={sentence(form?.women_owned)} />}
              <Detail label="Application ID" value={d.application_id ?? `Applicant ${d.applicant_id}`} />
            </div>
          </section>
          <section className="profile-section">
            <h3>Contact and officers</h3>
            <Record items={contactItems(d)} empty={d.form_status === 'ok' ? 'Nothing was answered in this part of the form.' : 'No contact details are available for this finalist.'} />
          </section>
          {womenQ && womenQ.answer.trim() && (
            <section className="profile-section">
              <h3>Women-owned enterprise</h3>
              <Record items={[itemOf(womenQ)]} />
            </section>
          )}
          <section className="profile-section">
            <h3>In brief</h3>
            <div className="detail-grid">
              <Detail label="Composite score" value={num(d.composite, 1)} />
              <Detail label="Ranking from composite score" value={d.rank ?? 'Not given in the sheet'} />
              {formOk && <Detail label="Members in 2024 (as stated)" value={num(form?.members['2024'])} />}
              {formOk && <Detail label="Employees in 2024 (as stated)" value={num(form?.employees['2024'])} />}
              {d.evaluator && <Detail label="Evaluator" value={d.evaluator} />}
              {c2 && <Detail label="Equity points" value={num(d.equity_points)} />}
              {formOk && <Detail label="Documents" value={d.documents.total} />}
            </div>
          </section>
          {d.flags.length > 0 && (
            <div className="fn-rule">
              <strong>Notes on this finalist's data</strong>
              <ul>{d.flags.map((f) => <li key={f}>{f}</li>)}</ul>
            </div>
          )}
          <BundleLink d={d} />
        </TabsContent>

        {/* Eligibility: the result, the five tests and what was checked, financial evidence, disqualifiers and penalties */}
        <TabsContent value="eligibility">
          <EligibilityTab d={d} rules={rules} />
        </TabsContent>

        {/* Evaluation: the scoring, exactly as the spreadsheet holds it */}
        <TabsContent value="evaluation">
          <section className="profile-section">
            <h3>Scoring items</h3>
            <div className="app-table-wrap">
              <table className="portfolio-table app-table">
                <thead><tr><th>Item</th><th className="gr-num">Rating (0 to 5)</th><th className="gr-num">Normalized</th><th className="gr-num">Weighted</th><th>Evaluator's logic</th></tr></thead>
                <tbody>
                  {d.criteria.map((c, i) => (
                    <tr key={c.code}>
                      <td><strong>{c.code}</strong> {c.label}</td>
                      <td className="gr-num">{c.rating ?? '-'}</td>
                      <td className="gr-num">{num(d.normalized[i]?.value)}</td>
                      <td className="gr-num">{num(d.weighted[i]?.value, 1)}</td>
                      <td className="fn-logic">{c.logic ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="profile-section">
            <h3>Totals and ranking</h3>
            <div className="detail-grid">
              {evaluationRows.map(([label, value]) => <Detail key={label} label={label} value={value} />)}
            </div>
          </section>
          {tierText && (
            <div className="fn-rule">
              <strong>{d.tier}</strong>
              <p>{tierText.replace(/^Tier \d\s*[–-]\s*/, '')}</p>
              <small>As written in the spreadsheet.</small>
            </div>
          )}
          <BundleLink d={d} />
        </TabsContent>

        {/* Application: the rest of the form, in the order of the form */}
        <TabsContent value="application">
          <FolderNotice d={d} />
          {d.form_status === 'ok' && (
            <>
              <p className="fn-note">{FINANCE_NOTE}</p>
              {d.form_notes.map((n) => <p key={n} className="fn-note">{n}</p>)}
              {applicationParts(d).map((part) => <section key={part.title} className="profile-section"><h3>{part.title}</h3><Answers questions={part.questions} /></section>)}
              {d.cohort === 1 && inRange(qs, 63, 63).map((q) => <p key={q.n} className="fn-note">{q.question}: {q.answer}</p>)}
            </>
          )}
        </TabsContent>

        {/* Membership and jobs: figures as the cluster stated them */}
        <TabsContent value="membership">
          <FolderNotice d={d} />
          {d.form_status === 'ok' && (
            <>
              <section className="profile-section">
                <h3>Members and employees</h3>
                <div className="job-table-wrap">
                  <table className="portfolio-table job-table">
                    <thead><tr><th /> {years.map((y) => <th key={y} className="gr-num">{y}</th>)}</tr></thead>
                    <tbody>
                      <tr><td>Members</td>{years.map((y) => <td key={y} className="gr-num"><strong>{num(form?.members[y])}</strong></td>)}</tr>
                      <tr><td>Employees</td>{years.map((y) => <td key={y} className="gr-num"><strong>{num(form?.employees[y])}</strong></td>)}</tr>
                    </tbody>
                  </table>
                </div>
                <div className="chart-box">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={growth} barCategoryGap="22%">
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} />
                      <YAxis tickFormatter={(v) => number(v)} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip formatter={(v, name) => [number(Number(v)), name]} contentStyle={tooltipStyle} cursor={{ fill: 'var(--muted)' }} />
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="Members" fill="var(--chart-1)" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="Employees" fill="var(--chart-2)" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>
              <section className="profile-section">
                <h3>Who the members are{form?.demographics ? ' (2024)' : ''}</h3>
                <div className="detail-grid">
                  <Detail label="Men" value={`${num(form?.males)}${share(form?.males, sexTotal)}`} />
                  <Detail label="Women" value={`${num(form?.females)}${share(form?.females, sexTotal)}`} />
                  <Detail label="Aged 18 to 35" value={`${num(form?.age_18_35)}${share(form?.age_18_35, ageTotal)}`} />
                  <Detail label="Aged 36 to 50" value={`${num(form?.age_36_50)}${share(form?.age_36_50, ageTotal)}`} />
                  <Detail label="Above 50" value={`${num(form?.age_over_50)}${share(form?.age_over_50, ageTotal)}`} />
                  <Detail label="Women-owned enterprise" value={sentence(form?.women_owned)} />
                </div>
                {form?.demographics && (
                  <div className="job-table-wrap">
                    <table className="portfolio-table job-table">
                      <thead><tr><th>Members by year</th>{years.map((y) => <th key={y} className="gr-num">{y}</th>)}</tr></thead>
                      <tbody>
                        {([['Men', 'males'], ['Women', 'females'], ['Aged 18 to 35', 'age_18_35'], ['Aged 36 to 50', 'age_36_50'], ['Above 50', 'age_over_50']] as const).map(([label, key]) => (
                          <tr key={key}><td>{label}</td>{years.map((y) => <td key={y} className="gr-num">{num(form.demographics?.[y]?.[key])}</td>)}</tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="fn-note">These are the figures the cluster typed into its application, not verified counts.</p>
              </section>
            </>
          )}
        </TabsContent>

        {/* Documents */}
        <TabsContent value="documents">
          <FolderNotice d={d} />
          {d.missing_files && d.missing_files.length > 0 && (
            <div className="notice fn-notice">
              <TriangleAlert size={16} />
              <div><strong>The bundle's own report lists files that could not be found.</strong> {d.missing_files.map((m) => `${m.type}${m.count > 1 ? ` (${m.count})` : ''}`).join(', ')}.</div>
            </div>
          )}
          {d.form_status === 'ok' && (
            <section className="profile-section">
              <h3>Documents <span className="fn-count">{d.documents_list.length}</span></h3>
              {d.documents_list.length === 0 && <div className="notice"><FolderOpen size={15} /><span>No documents were found in this finalist's folder.</span></div>}
              {docsByType.map(([type, files]) => (
                <div key={type} className="fn-docgroup">
                  <div className="detail-label mb-2 flex items-center gap-2"><FolderOpen size={11} />{type}<span className="text-muted-foreground">({files.length})</span></div>
                  <ul>
                    {files.map((x) => (
                      <li key={x.index}>
                        <a href={finalistDocumentUrl(d.cohort, d.applicant_id, x.index)} target="_blank" rel="noreferrer"><FileText size={12} />{x.name}</a>
                        <small>{size(x.size)}</small>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          )}
          <BundleLink d={d} />
        </TabsContent>
      </Tabs>
    </>
  );
}

export function FinalistProfile({ cohort, applicantId, rules, onClose }: { cohort: number; applicantId: string | null; rules?: FinalistRules; onClose: () => void }) {
  const { data, isLoading, error } = useFinalistDetail(cohort, applicantId);
  if (applicantId == null) return null;
  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="profile-sheet">
        {error ? (
          <div className="notice"><Info size={16} /><span>The finalist could not be loaded. Please close this panel and try again.</span></div>
        ) : isLoading || !data ? (
          <div className="flex items-center justify-center h-full"><Loader2 size={32} className="animate-spin text-muted-foreground" /></div>
        ) : (
          <Profile d={data} rules={rules} />
        )}
      </SheetContent>
    </Sheet>
  );
}
