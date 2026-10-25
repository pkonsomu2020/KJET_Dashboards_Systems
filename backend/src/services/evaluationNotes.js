/**
 * evaluationNotes.js
 *
 * The assessors write one long paragraph per sheet cell ("E1 (Pass): ... E2 (Pass): ..." for the
 * eligibility tests, "C1.1 (4): ... C1.2 (4): ..." for the scorecard). These helpers split the
 * paragraph into one note per test or sub-indicator so it can be laid out as a list. The wording is
 * never changed.
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

/** { E1: '...', E2: '...' } from "E1 (Pass): ... E2 (Hold): ..." */
export const splitEligibilityNotes = (text) => splitBy(text, /(?:^|\s)(E(?:10|[1-9])) \((?:Pass|Hold|Fail)\):\s*/g);

/** { 'C1.1': '...', 'C1.2': '...' } from "C1.1 (4): ... C1.2 (4): ..." */
export const splitCriterionNotes = (text) => splitBy(text, /(?:^|\s)(C[1-6]\.\d) \(\d\):\s*/g);
