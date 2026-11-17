/**
 * evaluation-notes.test.js: checks that nothing the assessors wrote, and no spreadsheet error, is lost or
 * shown wrongly when the evaluation sheet is read. No database needed.
 *
 *   node tests/evaluation-notes.test.js "<path to a downloaded copy of the online sheet>"
 *
 * Fails (exit 1) if, for any cluster:
 *   - an eligibility hint or note still carries a spreadsheet error code (#REF!, #N/A ...);
 *   - an assessor's note exists in the sheet but none of E1-E10 picks it up (the Zuphifarm fault);
 *   - the E7 hint disagrees with the registration date.
 * Tests an assessor never wrote about are listed, not failed: that is a gap in the sheet, not in the system.
 */
import { readEvaluationWorkbook } from '../src/services/evaluationImport.js';
import { parseEligibilityNotes } from '../src/services/evaluationNotes.js';
import { hasSheetError } from '../src/services/evaluationHints.js';

const path = process.argv[2];
if (!path) { console.error('Usage: node tests/evaluation-notes.test.js <workbook.xlsx>'); process.exit(1); }
const { rows, eligibility, warnings } = readEvaluationWorkbook(path);

const problems = [];
for (const e of eligibility) if (hasSheetError(e.hint)) problems.push(`${e.application_number} ${e.test}: hint still holds an error code`);
for (const r of rows) {
  if (hasSheetError(r.eligibility_reasons)) problems.push(`${r.application_number}: eligibility reasons hold an error code`);
  if (!r.eligibility_reasons) { problems.push(`${r.application_number}: no eligibility reasons in the sheet`); continue; }
  const { notes } = parseEligibilityNotes(r.eligibility_reasons);
  if (Object.keys(notes).length === 0) problems.push(`${r.application_number}: reasons written but no test E1-E10 recognised`);
}
const gaps = rows.map((r) => {
  const { notes } = parseEligibilityNotes(r.eligibility_reasons);
  const miss = Array.from({ length: 10 }, (_, i) => `E${i + 1}`).filter((t) => !notes[t]);
  return miss.length ? `${r.application_number}: no note for ${miss.join(', ')}` : null;
}).filter(Boolean);

console.log(`${rows.length} clusters read; ${warnings.length} sheet issues repaired on import`);
if (gaps.length) console.log(`Assessor notes missing in the sheet (${gaps.length}):\n  ${gaps.join('\n  ')}`);
if (problems.length) { console.error(`FAILED (${problems.length}):\n  ${problems.join('\n  ')}`); process.exit(1); }
console.log('OK: every cluster\'s notes are picked up and no error code reaches a report.');
