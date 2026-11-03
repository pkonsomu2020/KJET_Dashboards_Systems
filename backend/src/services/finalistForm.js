/**
 * finalistForm.js
 *
 * Reads a finalist's application form (the application_info PDF in its bundle folder) into question/answer
 * pairs grouped by section, and lists the other documents in the folder.
 *
 * The finance questions of the form (turnover, profit and price-cost margins) are NOT kept: the clusters
 * filled them in without evidence, so money is judged from the attached documents only.
 *
 * Reading is two steps because the PDF text does not say where a long question ends and its answer begins:
 * parseFormText() splits one form into raw questions, wrappedLines() learns from ALL the forms how the long
 * questions wrap (every form repeats the same question wording), and finalizeForm() builds the final pairs.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, extname } from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { PDFParse } = require('pdf-parse');

/** Finance questions that are left out of the dashboard: matched on how the question begins, never on words inside a long question. */
const FINANCE_QUESTION = /^(\d{4} (annual turnover|net \(after-tax\) profit)|do you know your price-cost margins)/i;

// Text coming out of the PDFs carries UTF-8 punctuation read as Windows-1252 ("â€¢" for a bullet), and HTML entities
const CP1252 = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e,
  0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};
const hex4 = (c) => `\\u${Number(c).toString(16).padStart(4, '0')}`;
const MOJIBAKE = new RegExp(`[\\u00c2-\\u00f4][\\u0080-\\u00bf${Object.keys(CP1252).map(hex4).join('')}]{1,3}`, 'g');
const utf8 = new TextDecoder('utf-8', { fatal: true });
const fixMojibake = (t) => t.replace(MOJIBAKE, (seq) => {
  try { return utf8.decode(Uint8Array.from([...seq].map((c) => CP1252[c.codePointAt(0)] ?? c.codePointAt(0)))); } catch { return seq; }
});
const ENTITIES = [['&#039;', "'"], ['&quot;', '"'], ['&lt;', '<'], ['&gt;', '>'], ['&amp;', '&']];
export const tidy = (s) => {
  let t = fixMojibake(String(s));
  for (const [a, b] of ENTITIES) t = t.split(a).join(b);
  // the new-platform PDFs lose their en dashes: "18<U+FFFD>35", "linkages <U+FFFD> current"
  t = t.replace(/(\d)�(\d)/g, '$1–$2').replace(/ � /g, ' – ');
  return t;
};

/** The section a question belongs to, by its number in the Cohort 1 form (the Cohort 2 form is read separately). */
function sectionOf(n) {
  if (n <= 24) return 'Application details';
  if (n <= 35) return 'Membership and employment';
  if (n <= 38) return 'Value chain';
  if (n <= 52) return 'Business';
  if (n <= 60) return 'Markets';
  return 'Challenges and sustainability';
}

/**
 * Splits form text into raw questions [{ n, first, rest }]: "first" is the line that starts the question,
 * "rest" the lines after it (the rest of a wrapped question, then the answer).
 * Questions run 1, 2, 3...: a line "N. text" only starts a new question when N is the next number,
 * so numbered lists inside an answer ("1. Raw Milk Aggregation") stay in the answer.
 */
export function parseFormText(text) {
  // page markers and the repeated page header go; so do the blank lines the page break leaves around them
  const lines = [];
  let skipBlank = false;
  for (const raw of tidy(text).split('\n')) {
    const t = raw.trim();
    if (/^-- \d+ of \d+ --$/.test(t) || t === 'Application Details') {
      while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
      skipBlank = true;
      continue;
    }
    if (skipBlank && t === '') continue;
    skipBlank = false;
    lines.push(raw.replace(/\s+$/, ''));
  }
  const out = [];
  let cur = null;
  for (const line of lines) {
    const m = /^(\d+)\.\s+(.+)$/.exec(line);
    if (m && Number(m[1]) === out.length + 1) {
      cur = { n: Number(m[1]), first: m[2].trim(), rest: [] };
      out.push(cur);
    } else if (cur) {
      cur.rest.push(line);
    }
  }
  return out;
}

/**
 * A long question wraps onto the next lines of the PDF, and its first line then looks like the start of an answer.
 * Every form carries the same question wording and only the answers differ, so the wrapped lines of question N are the
 * lines that come after it identically in (nearly) all the forms. A short answer can sit on the last wrapped line
 * ("...Kilimall, etc.)? No"): then only the part all the forms share belongs to the question.
 * Returns Map(N -> { lines: how many whole lines are question, partial: the shared start of the next line, if any }).
 */
export function wrappedLines(allForms) {
  const out = new Map();
  if (allForms.length < 3) return out;
  const byN = new Map();
  for (const form of allForms) for (const q of form) byN.set(q.n, [...(byN.get(q.n) ?? []), q]);
  for (const [n, qs] of byN) {
    // only a question whose first line stops mid-sentence can continue on the next line
    const open = qs.filter((q) => q.first.length >= 60 && !/[?:.]$/.test(q.first));
    if (open.length < qs.length * 0.95) continue;
    let lines = 0;
    let partial = '';
    for (; lines < 12; lines++) {
      const seen = open.map((q) => (q.rest[lines] ?? '').trim());
      if (seen.some((l) => !l)) break;
      if (seen.every((l) => l === seen[0])) continue;   // the same line in every form: more question
      let prefix = seen[0];
      for (const l of seen) { let i = 0; while (i < prefix.length && i < l.length && prefix[i] === l[i]) i++; prefix = prefix.slice(0, i); }
      if (prefix.trim().length >= 10 && /[?:.)]\s*$/.test(prefix)) partial = prefix.trim();
      break;
    }
    if (lines || partial) out.set(n, { lines, partial });
  }
  return out;
}

/** Joins lines the PDF wrapped in the middle of a sentence; sentence ends, blank lines and list items stay as they are. */
function unwrap(lines) {
  const out = [];
  for (const line of lines) {
    const t = line.trim();
    const prev = out.length ? out[out.length - 1].trim() : '';
    if (prev && t && !/[.:;!?)"'”]$/.test(prev) && !/^([-–•*]|\d+[.)]\s)/.test(t)) out[out.length - 1] = `${prev} ${t}`;
    else out.push(line);
  }
  return out.join('\n');
}

/** Turns raw questions into { n, question, answer, section }, given the wrapped-line counts from wrappedLines(). */
export function finalizeForm(raw, wrapped = new Map()) {
  return raw.map((q) => {
    const rest = [...q.rest];
    const w = wrapped.get(q.n) ?? { lines: 0, partial: '' };
    const parts = [q.first, ...rest.splice(0, w.lines).map((l) => l.trim())];
    if (w.partial && rest.length && rest[0].trim().startsWith(w.partial)) {
      parts.push(w.partial);
      const left = rest[0].trim().slice(w.partial.length).trim();
      if (left) rest[0] = left; else rest.shift();
    }
    let answer = unwrap(rest).replace(/\n{3,}/g, '\n\n').trim();
    // the women-owned question prints its criteria before the answer: the answer is the last line (Yes or No)
    if (q.n === 20 && /^(yes|no)$/i.test(answer.split('\n').pop().trim())) answer = answer.split('\n').pop().trim();
    return { n: q.n, question: parts.join(' '), answer, section: sectionOf(q.n) };
  });
}

/**
 * Reads an application form PDF. There are two kinds: the new platform's (a letterhead and numbered SECTIONS, used by Cohort 2)
 * and the older numbered list of questions (Cohort 1, and the Cohort 1 reapplicants in Cohort 2).
 */
export async function readFormPdf(path) {
  const parser = new PDFParse({ data: new Uint8Array(readFileSync(path)) });
  try {
    const { text, total } = await parser.getText();
    if (/KENYA JOBS AND ECONOMIC TRANSFORMATION/i.test(text.slice(0, 800))) return { kind: 'platform', pages: total, ...parsePlatformText(text) };
    return { kind: 'numbered', pages: total, raw: parseFormText(text) };
  } finally {
    await parser.destroy();
  }
}

// ── The new-platform form (Cohort 2) ──
// Its wording is fixed by the platform, so the questions are listed here in the order the form prints them. Each is found in the
// text however the PDF wrapped it, and its answer is everything up to the next question or the next section heading.
// Section 9 (financial information) and the price/cost margins answer are the finance part of the form and are left out.
// Sections 12 and 13 (the list of uploaded files, the declaration) say nothing about the cluster and are not read.
const PLATFORM_HEADINGS = {
  1: 'ORGANISATION DETAILS', 2: 'LOCATION INFORMATION', 3: 'BUSINESS INFORMATION', 4: 'CONTACT INFORMATION', 5: 'LEADERSHIP & OWNERSHIP',
  6: 'WOMEN-OWNED ENTERPRISE', 7: 'MEMBERSHIP & EMPLOYMENT BY YEAR', 8: 'GENDER & AGE DEMOGRAPHICS', 9: 'FINANCIAL INFORMATION',
  10: 'BUSINESS OPERATIONS & SYSTEMS', 11: 'E-COMMERCE & MARKET INFORMATION', 12: 'SUPPORTING DOCUMENTS', 13: 'DECLARATIONS & TERMS', 14: 'BUSINESS STRATEGY & CHALLENGES',
};
const PLATFORM_SECTIONS = {
  1: 'Organisation details', 2: 'Location information', 3: 'Business information', 4: 'Contact information', 5: 'Leadership and ownership',
  6: 'Women-owned enterprise', 7: 'Membership and employment by year', 8: 'Gender and age demographics', 9: 'Financial information',
  10: 'Business operations and systems', 11: 'E-commerce and market information', 14: 'Business strategy and challenges',
};
const YEARS = [2022, 2023, 2024];
// [section, question, optional]
const PLATFORM_QUESTIONS = [
  [1, 'What is the name of your cluster?'], [1, 'What is your registration status?'], [1, 'If "Other", specify your registration status:', true],
  [1, 'What is your registration number?'], [1, 'What year was your cluster/association/cooperative established?'],
  [2, 'Which county are you located in?'], [2, 'What constituency are you in?'], [2, 'What ward are you in?'], [2, 'What is your location / nearest landmark or village?'],
  [2, 'Where is your place of operation?'], [2, 'If "Other", specify your place of operation:', true],
  [3, 'What is the name of your operation?'], [3, 'Which value chain do you operate in?'], [3, 'Briefly describe your main economic activities:'],
  [4, 'Primary phone number for the cluster:'], [4, 'Alternate phone number:'], [4, 'Official email address for the cluster:'],
  [5, 'List of key officers (as provided in the form):'], [5, 'Name of the Chairperson:'], [5, 'Name of the Secretary:'], [5, 'Name of the CEO:'],
  [5, 'Name of the Director:'], [5, 'Name of the Manager:'], [5, 'Name of the Treasurer:'],
  [6, 'Is this a women-owned enterprise?'], [6, 'If yes, describe how it meets the women-owned criteria:', true],
  ...YEARS.flatMap((y) => [[7, `Total members in ${y}:`], [7, `Total employees in ${y}:`]]),
  ...YEARS.flatMap((y) => [[8, `Male members in ${y}:`], [8, `Female members in ${y}:`], [8, `Members aged 18–35 in ${y}:`], [8, `Members aged 36–50 in ${y}:`], [8, `Members aged over 50 in ${y}:`]]),
  ...YEARS.flatMap((y) => [[9, `Total revenue in ${y} (KES):`], [9, `Total profits in ${y} (KES):`]]),
  [10, 'List your most critical equipment for operations:'], [10, 'Describe your price / cost margins:'], [10, 'Which accounting package or system do you use?'],
  [10, 'If "Other", specify the accounting package:', true],
  [11, 'Which e-commerce or digital channels do you use?'], [11, 'Roughly what percentage of your sales are B2B?'], [11, 'Roughly what percentage of your sales are B2C?'],
  [11, 'Roughly what percentage of your sales are exports?'], [11, 'Describe your main B2B buyers:', true], [11, 'Describe your main B2C buyers:', true], [11, 'Describe your main export buyers:', true],
  [14, 'Does the organization have clear objectives and performance targets in place? Please specify the targets and how they are reviewed: (200 words or less)'],
  [14, "Who are your organization's main competitors? (If this differs by product/sales channel, please specify): (200 words or less)"],
  [14, 'What are critical success factors in your industry? What makes your organization unique versus competitors?: (200 words or less)'],
  [14, 'Please describe your backward linkages – current suppliers of raw materials. Specify the main items your organization procures. For each item, indicate: Whether it is locally sourced or imported, Whether it is procured from large firms, MSMEs, cooperatives, or other types of suppliers, Any notable challenges or dependencies in your supply chain: (200 words or less)'],
  [14, 'What is your marketing plan for future market expansion? Please describe the markets you aim to grow in, the reasons for targeting them, and your strategies for achieving this growth. Include details such as: Customer outreach methods, Operational enhancements, Planned investments, Progress made so far (e.g., discussions or MOUs with potential customers): (200 words or less)'],
  [14, "What is the problem statement - description of the current challenges of the cluster's business activities and the needs to be addressed? Additionally, specify specific areas where project Business Development Services support could be helpful: (200 words or less)"],
  [14, 'Describe the challenges your cluster is currently facing and the specific needs to be addressed. Highlight areas where project Business Development Services support could be beneficial: (200 words or less)'],
  [14, 'What sustainable practices have you adopted? Sustainable practices refer to environmentally friendly initiatives or actions taken by your cluster to minimize negative impacts on the environment and impacts from the environment (e.g., resilience to drought). Please describe any green initiatives implemented by the cluster, if any: (200 words or less)'],
  [14, 'Describe any green initiatives or sustainable practices your cluster has implemented: (200 words or less)', true],   // one form has only the long version above
];
const escapeRe = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// a question matches however the PDF wrapped it, and even where it dropped a space ("friendlyinitiatives"): any run of white space, or none, stands for the gap
const PLATFORM_PATTERNS = PLATFORM_QUESTIONS.map(([section, q, optional]) => ({ section, q, optional: !!optional, re: new RegExp(q.trim().split(/\s+/).map(escapeRe).join('\\s*')) }));
const isFinancePlatform = (section, q) => section === 9 || /price \/ cost margins/i.test(q);
const letters = (s) => String(s).toUpperCase().replace(/[^A-Z]/g, '');

/**
 * Reads one new-platform form: the letterhead, then each question with its answer. Nothing is guessed: a required question
 * the form does not contain is reported in "platformMissing" so it can be seen and fixed, not skipped silently.
 */
export function parsePlatformText(text) {
  const body = tidy(text).split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => !/^-- \d+ of \d+ --$/.test(l.trim())).join('\n');

  // section headings, in order: "N. TITLE" counts only when N is the next number and the title is that section's
  const headings = [];
  let next = 1;
  for (const m of body.matchAll(/^(\d+)\.\s+([A-Z][^\n]*)$/gm)) {
    if (Number(m[1]) === next && letters(m[2]).startsWith(letters(PLATFORM_HEADINGS[next] ?? '#'))) { headings.push({ n: next, at: m.index }); next++; }
  }
  const sectionStart = (n) => headings.find((h) => h.n === n)?.at ?? -1;
  const headingAfter = (pos) => headings.find((h) => h.at > pos)?.at ?? body.length;

  const head = body.slice(0, headings[0]?.at ?? 800);
  const grab = (re) => (re.exec(head) ?? [])[1]?.trim() ?? null;
  const platformHeader = {
    cluster: grab(/Cluster \/ Enterprise:\s*(.+)/),
    application_no: grab(/Application No:\s*(KJET-[\w-]+)/),
    status: grab(/Status:\s*(\w+)/),
    cohort: grab(/Cohort:\s*([^\n]+)/),
    submitted: grab(/Submitted:\s*([^\n]+)/),
  };

  // find each question, in order, inside its own section
  const found = [];
  const missing = [];
  let cursor = 0;
  for (const item of PLATFORM_PATTERNS) {
    const start0 = Math.max(cursor, sectionStart(item.section));
    const limit = headingAfter(start0 + 1);
    const m = item.re.exec(body.slice(start0, Math.max(start0, limit)));
    if (!m) { if (!item.optional) missing.push(item.q); continue; }
    const start = start0 + m.index;
    found.push({ ...item, start, end: start + m[0].length });
    cursor = start + m[0].length;
  }
  const platformRaw = found.map((f, k) => {
    const answer = body.slice(f.end, Math.min(found[k + 1]?.start ?? body.length, headingAfter(f.end))).trim();
    // sections 7 to 9 are single figures, each followed by a year marker ("2023") that belongs to the next block, not to this answer
    return { section: f.section, question: f.q, answer: f.section >= 7 && f.section <= 9 ? answer.split('\n')[0].trim() : answer };
  });
  return { platformHeader, platformRaw, platformMissing: missing, raw: [] };
}

/** The final pairs { n, question, answer, section } of a new-platform form, without its finance part. */
export function finalizePlatform(platformRaw) {
  return platformRaw
    .filter((r) => !isFinancePlatform(r.section, r.question) && !/^List of key officers/.test(r.question))
    .map((r, i) => ({
      n: i + 1,
      question: r.question.replace(/:$/, ''),
      answer: unwrap(r.answer.split('\n')).replace(/\n{3,}/g, '\n\n').trim(),
      section: PLATFORM_SECTIONS[r.section],
    }));
}

/** Drops the finance questions and returns the rest in form order. */
export const withoutFinance = (questions) => questions.filter((q) => !FINANCE_QUESTION.test(q.question));

const num = (s) => {
  const v = Number(String(s ?? '').replace(/[,\s]/g, ''));
  return String(s ?? '').trim() === '' || !Number.isFinite(v) ? null : v;
};
const find = (qs, re) => qs.find((q) => re.test(q.question))?.answer ?? '';

/** The figures the dashboard shows and adds up: membership, employment, gender and age. All as stated by the cluster. */
export function summariseForm(questions) {
  const byYear = (re) => ({ 2022: num(find(questions, re(2022))), 2023: num(find(questions, re(2023))), 2024: num(find(questions, re(2024))) });
  const members = byYear((y) => new RegExp(`(Number of|Total) members in ${y}`, 'i'));
  const employees = byYear((y) => new RegExp(`(Number of|Total) employees in ${y}`, 'i'));
  // the new platform gives the gender and age split for every year; the older form gives one split, taken to be the latest
  const split = (y) => ({
    males: num(find(questions, new RegExp(`Male members in ${y}`, 'i'))),
    females: num(find(questions, new RegExp(`Female members in ${y}`, 'i'))),
    age_18_35: num(find(questions, new RegExp(`aged 18.35 in ${y}`, 'i'))),
    age_36_50: num(find(questions, new RegExp(`aged 36.50 in ${y}`, 'i'))),
    age_over_50: num(find(questions, new RegExp(`aged over 50 in ${y}`, 'i'))),
  });
  const demographics = questions.some((q) => /Male members in 2024/i.test(q.question)) ? { 2022: split(2022), 2023: split(2023), 2024: split(2024) } : null;
  const latest = demographics?.[2024] ?? {
    males: num(find(questions, /Number of males/i)),
    females: num(find(questions, /Number of females/i)),
    age_18_35: num(find(questions, /aged 18-35/i)),
    age_36_50: num(find(questions, /aged 36-50/i)),
    age_over_50: num(find(questions, /above 50/i)),
  };
  const status = find(questions, /registration status\?/i);
  const statusOther = find(questions, /specify your registration status|registration status \(other\)/i);
  return {
    members, employees, ...latest, demographics,
    women_owned: find(questions, /wom[ae]n-owned enterprise/i) || null,
    registration_status: (/^other$/i.test(status) && statusOther ? statusOther : status) || null,
    constituency: find(questions, /constituency/i) || null,
    ward: find(questions, /\bward\b/i) || null,
  };
}

// ── The documents in a bundle folder ──
const DOC_TYPES = [
  [/application_info|^application_[A-Za-z0-9-]+\.pdf$/i, 'Application form'],
  [/mpesa|m-pesa/i, 'M-Pesa statements'],
  [/income statement|profit and loss|profit & loss/i, 'Income statements'],
  [/balance sheet|financial position/i, 'Balance sheets'],
  [/cash ?-?flow/i, 'Cash-flow statements'],
  [/bank statement|estatement|e-statement|acc(ount)? statement|pdfstatement/i, 'Bank statements'],
  [/basic books|cash-based|cash book|receipts?|ledger/i, 'Books and receipts'],
  [/financial statement|audit/i, 'Financial statements'],
  [/registration|certificate|incorporation|\bcert\b/i, 'Registration certificate'],
];
export function documentType(name) {
  for (const [re, label] of DOC_TYPES) if (re.test(name)) return label;
  return 'Other document';
}

/** Every file under a finalist's folder: { path (relative to the cohort folder), name, type, size }. The .zip of the original bundle is not listed. */
export function listDocuments(folder, root) {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      // the bundle's own missing-files report is read separately (missing_files); it is not a document the cluster supplied
      else if (extname(e.name).toLowerCase() !== '.zip' && !/^MISSING_FILES_REPORT\.txt$/i.test(e.name)) out.push({ path: relative(root, p).split('\\').join('/'), name: e.name, type: documentType(e.name), size: statSync(p).size });
    }
  };
  walk(folder);
  return out.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
}
