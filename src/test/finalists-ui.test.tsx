import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

// Recharts measures its container with ResizeObserver, which jsdom does not provide
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

import { FinalistsPage } from '@/components/dashboard/finalists-pages';
import type { Finalist, FinalistDetail, FinalistListResponse } from '@/data/api';

const crit = (ratings: number[]) => ratings.map((rating, i) => ({ code: `A3.${i + 1}`, label: `Item ${i + 1}`, rating, logic: `logic ${i + 1}` }));
const vals = (v: number) => ['A3.1', 'A3.2', 'A3.3', 'A3.4', 'A3.5', 'A3.6'].map((code) => ({ code, value: v }));

const make = (id: number, name: string, county: string, composite: number, over: Partial<Finalist> = {}): Finalist => ({
  cohort: 1, applicant_id: String(id), application_id: `applicant ${id}`, cluster_name: name, application_number: `KJET-AAAA0${id}`, registration_number: `CS/${id}`, registration_status: 'Cooperative',
  county, constituency: 'X', ward: 'Y', value_chain: 'Dairy', other_value_chain: null,
  checks: { e1: `CS/${id}`, e2: county, e3: 'Dairy', e4: 'Bank statement', e5: '0700000000' },
  result: 'Pass', reason: 'All requirements met', criteria: crit([5, 4, 3, 2, 4, 5]), disqualifier: null, tier: 'Tier 1',
  normalized: vals(80), weighted: vals(12), total: composite, equity_points: null, penalty: 0, composite, rank: 1, evaluator: 'Magdaline', track_years: 3, rank_in_county: null,
  sheet_link: `https://docs.google.com/spreadsheets/d/SHEET/edit#gid=1&range=A${id}`,
  drive_link: `https://drive.google.com/file/d/FILE${id}/view?usp=drive_link`, drive_file: `application_${id}_bundle.zip`,
  contact: null, flags: [], form_status: 'ok', form_note: null, form_notes: [], missing_files: null,
  form: { members: { 2022: 1, 2023: 2, 2024: 3 }, employees: { 2022: 1, 2023: 2, 2024: 3 }, males: 1, females: 2, age_18_35: 1, age_36_50: 1, age_over_50: 1, demographics: null, women_owned: 'Yes', registration_status: 'Cooperative', constituency: 'X', ward: 'Y' },
  documents: { total: 3, by_type: { 'Bank statements': 2, 'Registration certificate': 1 }, financial_types: ['Bank statements'] },
  ...over,
});

const alpha = make(297, 'ALPHA DAIRY UNION', 'Baringo', 93);
const beta = make(352, 'BETA TEXTILES', 'Bomet', 80, { value_chain: 'Textile', tier: 'Tier 2' });
const noName = make(555, 'x', 'Bomet', 70, { cluster_name: null, documents: { total: 0, by_type: {}, financial_types: [] } });

const list = {
  ok: true, data: [alpha, beta, noName],
  meta: { rules: { eligibility: ['Decision Box – Eligibility', 'If any E1–E5 fails → mark INELIGIBLE; exclude from scoring.', 'If all pass → proceed to Primary Criteria scoring.'], disqualifiers: ['DQ1: Fraudulent documents or misrepresentation → Immediate disqualification.'], tiers: ['Tier 1 – Clusters functioning as integrated businesses.', 'Tier 2 – Clusters where member MSMEs operate more independently.'], financial_evidence: ['Evidence Box – Financial', 'Accept: bank/M-Pesa PDFs, screenshots'] }, sheet: { sheet_name: 'KJET FINAL ANALYSIS COHORT 1', sheet_modified: null, last_checked: null, last_imported: null, last_error: null }, sheet_link: 'https://docs.google.com/spreadsheets/d/SHEET/edit#gid=1', forms_read: 3, forms_wrong: 0 },
} as unknown as FinalistListResponse;

const detail: FinalistDetail = {
  ...alpha, folder: 'BARINGO/applicant 297 - ALPHA',
  questions: [
    { n: 6, question: 'What is your registration number?', answer: 'CS/297', section: 'Application details' },
    { n: 7, question: 'Which county are you located in?', answer: 'Baringo', section: 'Application details' },
    { n: 11, question: 'What is your phone number?', answer: '0700000000', section: 'Application details' },
    { n: 36, question: 'What is your value chain?', answer: 'Dairy', section: 'Value chain' },
    { n: 21, question: 'If yes, please explain how your enterprise meets the criteria:', answer: 'The Union has made strides in gender equity.\n- 30% of active members are women.\n-30% of board members are women.', section: 'Application details' },
    { n: 25, question: 'Number of members in 2022', answer: '15024', section: 'Membership and employment' },
    { n: 38, question: 'Please describe your economic activities and participation along the value chain. Include: What products/services you offer?', answer: '- We collect and process milk.\n- We sell to wholesalers.\nApproximately 90% of turnover is from raw milk.\nThe rest is from processing.', section: 'Value chain' },
  ],
  documents_list: [
    { index: 0, name: 'application_info_297.pdf', type: 'Application form', size: 2048 },
    { index: 1, name: 'Bank Statements_2024.pdf', type: 'Bank statements', size: 3 * 1048576 },
  ],
};

function renderPage() {
  const qc = new QueryClient();
  qc.setQueryData(['finalists', 1, 'list'], list);
  qc.setQueryData(['finalists', 1, 'detail', '297'], detail);
  return render(<QueryClientProvider client={qc}><FinalistsPage cohort={1} /></QueryClientProvider>);
}

describe('Cohort 1 finalists page', () => {
  it('shows every finalist with its county, scores and a link to its row of the spreadsheet', () => {
    renderPage();
    expect(screen.getByText('ALPHA DAIRY UNION')).toBeTruthy();
    expect(screen.getByText('BETA TEXTILES')).toBeTruthy();
    expect(screen.getByText('applicant 555')).toBeTruthy();   // no name in the Master List: the Application ID still shows
    expect(screen.getByText('3 finalists')).toBeTruthy();
    // View profile sits in the last column; the sheet link lives in the profile, not in the table
    const button = screen.getByLabelText('View profile of ALPHA DAIRY UNION');
    const cells = button.closest('tr')!.querySelectorAll('td');
    expect(cells[cells.length - 1]!.contains(button)).toBe(true);
    expect(screen.queryByText('Sheet row')).toBeNull();

    // each scoring item is a column of its own; no Eligibility and no Documents column
    const heads = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(heads).toEqual(['Finalist', 'County', 'A3.1', 'A3.2', 'A3.3', 'A3.4', 'A3.5', 'A3.6', 'Composite score', '']);
    const row = button.closest('tr')!;
    expect([...row.querySelectorAll('td.fn-rate')].map((td) => td.querySelector('strong')?.textContent)).toEqual(['5/5', '4/5', '3/5', '2/5', '4/5', '5/5']);
    expect(screen.queryByText(/Eligibility/)).toBeNull();
    expect(screen.queryByText(/in county/)).toBeNull();   // the sheet leaves RANK_IN_COUNTY empty: nothing is invented
  });

  it('filters by county, value chain and search', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Filter by county'), { target: { value: 'Bomet' } });
    expect(screen.queryByText('ALPHA DAIRY UNION')).toBeNull();
    expect(screen.getByText('2 of 3 finalists')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Filter by county'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Filter by value chain'), { target: { value: 'Textile' } });
    expect(screen.getByText('BETA TEXTILES')).toBeTruthy();
    expect(screen.queryByText('ALPHA DAIRY UNION')).toBeNull();
    fireEvent.click(screen.getByLabelText('Clear filters'));
    fireEvent.change(screen.getByLabelText('Search finalists'), { target: { value: 'cs/297' } });
    expect(screen.getByText('1 of 3 finalists')).toBeTruthy();
  });

  it('opens a profile panel on the right with tabs: sheet values, application form without finance questions, membership and documents', () => {
    renderPage();
    fireEvent.click(screen.getByLabelText('View profile of ALPHA DAIRY UNION'));
    expect(screen.getByText('COHORT 1 FINALIST')).toBeTruthy();
    // the Application ID is the one in the finalist sheet, not the KJET-style number the co-investment pages use
    expect(screen.getAllByText('applicant 297').length).toBeGreaterThan(1);   // in the row and in the panel header
    expect(screen.queryByText(/KJET-AAAA0297/)).toBeNull();
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual(['Overview', 'Eligibility', 'Evaluation', 'Application', 'Membership and jobs', 'Documents']);
    const open = (name: string) => fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0, ctrlKey: false });

    // the women-owned explanation reads as an intro and two bullets, on a full row of its own
    const wide = document.querySelector('.fn-wide') as HTMLElement;
    expect(wide.textContent).toContain('How the enterprise meets the women-owned criteria');
    expect([...wide.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['30% of active members are women.', '30% of board members are women.']);
    expect(wide.querySelectorAll('p').length).toBe(1);

    // The link goes to this finalist's own bundle in Google Drive, not to the spreadsheet
    const bundle = screen.getByText("Open this finalist's bundle in Google Drive").closest('a') as HTMLAnchorElement;
    expect(bundle.getAttribute('href')).toBe('https://drive.google.com/file/d/FILE297/view?usp=drive_link');
    expect(screen.queryByText(/row in the Cohort 1 spreadsheet/)).toBeNull();

    // Overview: contact and officers from the form
    expect(screen.getByText('Phone number')).toBeTruthy();
    expect(screen.queryByText(/What is your/)).toBeNull();
    expect(screen.queryByText(/^Question \d+$/)).toBeNull();   // the Overview is a record, not a list of answered questions

    // Eligibility: the result, the five tests with what was recorded and a cross-check, the sheet's own rules
    open('Eligibility');
    expect(screen.getByText(/passed the eligibility tests/)).toBeTruthy();
    expect(screen.getByText('If any E1–E5 fails → mark INELIGIBLE; exclude from scoring.')).toBeTruthy();
    expect(screen.getAllByText('Same as in the application form').length).toBeGreaterThan(0);
    expect(screen.getByText(/DQ1: Fraudulent documents/)).toBeTruthy();
    expect(screen.getByText('Bank statements: 1 on file')).toBeTruthy();

    // Evaluation: the spreadsheet's own scoring
    open('Evaluation');
    expect(screen.getByText(/Clusters functioning as integrated businesses/)).toBeTruthy();
    expect(screen.getByText("Evaluator's logic")).toBeTruthy();
    expect(screen.getByText('logic 1')).toBeTruthy();

    // Application: the other parts of the form, never the finance questions
    open('Application');
    expect(screen.getByText(/finance questions of the form .* are left out/)).toBeTruthy();
    // each long answer is a card: a short title, bullets and paragraphs, and the full question behind "Show the question"
    expect(screen.getByRole('heading', { name: 'Economic activities and role in the value chain' })).toBeTruthy();
    expect(document.querySelectorAll('.fn-card .fn-prose li').length).toBe(2);
    expect(document.querySelectorAll('.fn-card .fn-prose p').length).toBe(1);
    expect(screen.getByText('Show the question')).toBeTruthy();
    const questions = [...document.querySelectorAll('.detail-label')].map((n) => n.textContent ?? '');
    expect(questions.some((q) => /Annual Turnover|Net \(After-Tax\) Profit|price-cost margins/i.test(q))).toBe(false);

    // Membership and jobs: as the cluster stated them
    open('Membership and jobs');
    expect(screen.getByText(/not verified counts/)).toBeTruthy();

    // Documents: opened through the API with the login
    open('Documents');
    const doc = screen.getByText('Bank Statements_2024.pdf').closest('a') as HTMLAnchorElement;
    expect(doc.getAttribute('href')).toMatch(/\/api\/finalists\/1\/297\/documents\/1$/);
    expect(within(doc.closest('li')!).getByText('3.0 MB')).toBeTruthy();
  });
});


// ── Cohort 2: the Selected tab has no PASS/FAIL, E4 and E5 are the evaluator's own notes, and some folders hold another cluster's application ──
const KEY_A = 'KJET-20251229171110-PYGB', KEY_B = 'KJET-20251228165146-KTAW', KEY_C = '257';
const c2 = (key: string, name: string, county: string, composite: number, over: Partial<Finalist> = {}): Finalist => ({
  ...make(1, name, county, composite),
  cohort: 2, applicant_id: key, application_id: `Applicant_${key}`, application_number: key.startsWith('KJET') ? key : null,
  registration_number: 'CS/957', result: null, evaluator: null, track_years: null, equity_points: 5, tier: 'Tier 1',
  checks: { e1: 'CS/957', e2: county.toUpperCase(), e3: 'Dairy', e4: 'no-handwritten financial book', e5: 'yes-phone number and email address given' },
  contact: { phone: '0112845394', alt_phone: null, email: 'sabatia@example.com' },
  drive_link: `https://drive.google.com/drive/folders/FOLDER${key}?usp=drive_link`, drive_file: `application_${key}_with_attachments`,
  ...over,
});
const wrongForm: Partial<Finalist> = { form: null, form_status: 'wrong_application', form_note: 'The application form in this finalist\'s folder is for application KJET-20251231214405-HRDX (BARINGO PURE LOWLAND ORGANIC HONEY LTD), not for KJET-20251228165146-KTAW.', documents: { total: 0, by_type: {}, financial_types: [] }, drive_link: null, flags: ['The Drive link in the sheet opens "application_KJET-20251231214405-HRDX_with_attachments", which is not this finalist\'s own bundle, so no Drive link is shown.'] };
const finA = c2(KEY_A, 'SABATIA FARMERS COOPERATIVE', 'Baringo', 84);
const finB = c2(KEY_B, 'TORONGO FARMERS CO-OPERATIVE', 'Baringo', 77, wrongForm);
const finC = c2(KEY_C, 'KIPLOMBE FARMERS', 'Baringo', 78);
const list2 = { ok: true, data: [finA, finB, finC], meta: { ...list.meta, forms_read: 2, forms_wrong: 1, sheet: { ...list.meta.sheet, sheet_name: 'EVALUATION COHORT 2' } } } as unknown as FinalistListResponse;
const detail2 = (f: Finalist, questions: FinalistDetail['questions'] = []): FinalistDetail => ({
  ...f, folder: `BARINGO/Applicant_${f.applicant_id}`, questions, documents_list: f.form_status === 'ok' ? [{ index: 0, name: 'Supporting_Documents_Bank statements_1.pdf', type: 'Bank statements', size: 4096 }] : [],
});
const q2: FinalistDetail['questions'] = [
  { n: 1, question: 'What is the name of your cluster', answer: 'SABATIA FARMERS COOPERATIVE', section: 'Organisation details' },
  { n: 2, question: 'What is your registration number', answer: 'CS/No: 957', section: 'Organisation details' },
  { n: 3, question: 'Which county are you located in', answer: 'baringo', section: 'Location information' },
  { n: 4, question: 'Which value chain do you operate in', answer: 'Dairy', section: 'Business information' },
  { n: 5, question: 'Name of the Chairperson', answer: 'Francis Kigen', section: 'Leadership and ownership' },
  { n: 6, question: 'Briefly describe your main economic activities', answer: 'We aggregate milk.\n- We make yoghurt.\n- We sell to retailers.', section: 'Business information' },
];

function renderPage2() {
  const qc = new QueryClient();
  qc.setQueryData(['finalists', 2, 'list'], list2);
  qc.setQueryData(['finalists', 2, 'detail', KEY_A], detail2(finA, q2));
  qc.setQueryData(['finalists', 2, 'detail', KEY_B], detail2(finB));
  return render(<QueryClientProvider client={qc}><FinalistsPage cohort={2} /></QueryClientProvider>);
}

describe('Cohort 2 finalists page', () => {
  it('describes the cohort, counts the Cohort 1 alternates and warns that a folder is not shown', () => {
    renderPage2();
    expect(screen.getByText(/The top 6 applicants in each county who met the eligibility criteria, as scored in the Cohort 2 spreadsheet \(tab Selected\)/)).toBeTruthy();
    expect(screen.getByText('Top 6 in each county')).toBeTruthy();
    expect(screen.getByText('Cohort 1 alternates')).toBeTruthy();           // Applicant_257 is a Cohort 1 number
    expect(screen.getByText(/1 finalist folder on file hold another cluster's application/)).toBeTruthy();
    expect(screen.getByText(`Applicant_${KEY_A}`)).toBeTruthy();            // the sheet's own Application ID
    expect(screen.getByText('3 finalists')).toBeTruthy();
  });

  it('shows the Selected-tab eligibility, the evaluator\'s own E4 and E5 notes, and cross-checks the form', () => {
    renderPage2();
    fireEvent.click(screen.getByLabelText('View profile of SABATIA FARMERS COOPERATIVE'));
    const open = (name: string) => fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0, ctrlKey: false });
    // the sheet's phone and e-mail are shown (not the form's), with the officers from the form
    expect(screen.getByText('0112845394')).toBeTruthy();
    expect(screen.getByText('Francis Kigen')).toBeTruthy();
    open('Eligibility');
    expect(screen.getAllByText('Listed in the Selected tab').length).toBeGreaterThan(0);
    expect(screen.queryByText(/passed the eligibility tests/)).toBeNull();     // no PASS/FAIL column exists for Cohort 2
    expect(screen.getAllByText('no-handwritten financial book').length).toBeGreaterThan(0);   // the evaluator's words, verbatim
    expect(screen.getAllByText(/The evaluator's note says no/).length).toBeGreaterThan(0);   // ... and a "no" is not hidden
    expect(screen.getAllByText('Same as in the application form').length).toBe(3);   // "CS/No: 957" is the same registration number as "CS/957"; county and value chain agree too
    open('Evaluation');
    expect(screen.getByText('Equity points')).toBeTruthy();
    open('Application');
    expect(screen.getByRole('heading', { name: 'Main economic activities' })).toBeTruthy();   // a card per long answer, as for Cohort 1
  });

  it('shows nothing from a folder that holds another cluster\'s application, and says why', () => {
    renderPage2();
    fireEvent.click(screen.getByLabelText('View profile of TORONGO FARMERS CO-OPERATIVE'));
    const open = (name: string) => fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0, ctrlKey: false });
    expect(screen.getAllByText(/Nothing from this finalist's application folder is shown/).length).toBeGreaterThan(0);
    expect(screen.getByText(/BARINGO PURE LOWLAND ORGANIC HONEY LTD/)).toBeTruthy();
    open('Documents');
    expect(screen.getAllByText(/Nothing from this finalist's application folder is shown/).length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.fn-docgroup').length).toBe(0);          // no documents listed
    // the sheet's own link for this finalist pointed at another cluster, so the fallback is the spreadsheet row
    expect(screen.getByText(/Open this finalist's row in the Cohort 2 spreadsheet/)).toBeTruthy();
    open('Application');
    expect(document.querySelectorAll('.fn-card').length).toBe(0);              // no answers
    open('Membership and jobs');
    expect(document.querySelector('.job-table')).toBeNull();                   // no figures
  });
});
