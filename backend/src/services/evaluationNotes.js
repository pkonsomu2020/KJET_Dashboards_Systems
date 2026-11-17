/**
 * evaluationNotes.js
 *
 * The assessors write one long paragraph per sheet cell ("E1 (Pass): ... E2 (Pass): ..." for the
 * eligibility tests, "C1.1 (4): ... C1.2 (4): ..." for the scorecard). These helpers split the
 * paragraph into one note per test or sub-indicator so it can be laid out as a list. The wording is
 * never changed.
 *
 * Assessors do not all write the same way, so the eligibility splitter accepts every form found in the
 * sheet: "E1 (Pass):", "E6 HOLD:", "E5 PASS on the new figures ...", and grouped notes such as
 * "E1-E3 PASS:", "E7-E10 PASS:" or "E1/E2/E3 FAIL:". A grouped note covers every test it names. Text
 * before the first test (for example a "CORRECTED ..." remark) is kept as the preamble.
 */

function splitBy(text, re) {
  const out = {};
  if (!text) return out;
  const s = String(text);
  const marks = [...s.matchAll(re)];
  marks.forEach((m, i) => {
    const end = marks[i + 1]?.index ?? s.length;
    out[m[1]] = s.slice(m.index + m[0].length, end).trim();
  });
  return out;
}

// A test marker starts the text or a sentence ("... ). E4 PASS:") and names a decision. In-sentence mentions such
// as "the existing E5 Pass decision" are not markers because they do not follow a sentence end.
const ELIG_MARK = /(?:^|(?<=[.;:)\]"'”]\s))E(10|[1-9])((?:\s*[-–/,&]\s*E?(?:10|[1-9])(?!\d))*)\s*(?:\((Pass|Hold|Fail)\)|(Pass|Hold|Fail)(?![a-z])|CORRECTED(?:\s*\([^)]*\))?)\s*:?\s*/gi;

function expandTests(first, tail) {
  const tests = [Number(first)];
  for (const m of tail.matchAll(/([-–/,&])\s*E?(10|[1-9])(?!\d)/g)) {
    const to = Number(m[2]);
    const from = tests[tests.length - 1];
    if (/[-–]/.test(m[1])) for (let n = from + 1; n <= to; n++) tests.push(n);
    else tests.push(to);
  }
  return [...new Set(tests)].map((n) => `E${n}`);
}

/**
 * { preamble, notes: { E1: { text, group: ['E1','E2','E3'], first: 'E1' }, ... } }
 * Every test a marker names gets the marker's text; `first` is the test the text is shown under.
 */
export function parseEligibilityNotes(text) {
  const s = text == null ? '' : String(text);
  const marks = [...s.matchAll(ELIG_MARK)];
  const notes = {};
  marks.forEach((m, i) => {
    const end = marks[i + 1]?.index ?? s.length;
    const body = s.slice(m.index + m[0].length, end).trim();
    const group = expandTests(m[1], m[2] ?? '');
    for (const t of group) if (!notes[t]) notes[t] = { text: body, group, first: group[0] };
  });
  const preamble = marks.length ? s.slice(0, marks[0].index).trim() : s.trim();
  return { preamble: preamble || null, notes };
}

/** { E1: '...', E2: '...' }: the note for each test (a grouped note is returned under every test it covers). */
export const splitEligibilityNotes = (text) => {
  const { notes } = parseEligibilityNotes(text);
  return Object.fromEntries(Object.entries(notes).map(([k, v]) => [k, v.text]));
};

/** { 'C1.1': '...', 'C1.2': '...' } from "C1.1 (4): ... C1.2 (4): ..." */
export const splitCriterionNotes = (text) => splitBy(text, /(?:^|\s)(C[1-6]\.\d) \(\d\):\s*/g);
