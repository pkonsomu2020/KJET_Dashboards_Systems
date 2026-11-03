/**
 * audit-finalist-forms.mjs: every answer the dashboard shows from a finalist's application form must be in the form itself.
 * The PDFs are read with poppler's pdftotext (not the reader the dashboard uses). Uses the finalist API output saved by audit-finalists1.mjs.
 *
 *   AUDIT_OUT=<file> node tests/audit/audit-finalists1.mjs   then   node tests/audit/audit-finalist-forms.mjs <file> <bundles dir> [cohort]
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { makeChecker } from './lib.mjs';

const { check, report } = makeChecker();
const api = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const bundles = process.argv[3];
// ignore spacing, quote/dash styles and line-wrap hyphenation: only the letters, digits and symbols that carry meaning
// the PDFs carry text saved with the wrong encoding ("â€™" for an apostrophe, "&#039;", "&amp;"): undo that on the PDF side, then compare letters and digits only
const deMoji = (t) => String(t ?? '').replace(/â€[™˜]/g, "'").replace(/â€[œ]|â€/g, '"').replace(/â€[“”–”—]/g, '-').replace(/â€¢/g, ' ').replace(/&#0?39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/&(lt|gt|quot);/g, ' ');
const squash = (s) => deMoji(s).normalize('NFKC').toLowerCase().replace(/application details/g, '').replace(/[^a-z0-9]/g, '');
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const folders = new Map();
for (const c of readdirSync(bundles, { withFileTypes: true }).filter((e) => e.isDirectory())) for (const f of readdirSync(join(bundles, c.name), { withFileTypes: true }).filter((e) => e.isDirectory())) folders.set(`${c.name}/${f.name}`, join(bundles, c.name, f.name));

let answers = 0;
for (const f of api.rows) {
  const d = api.detail[f.applicant_id];
  const dir = folders.get(d.folder); check('the folder named by the dashboard exists', !!dir, `${f.applicant_id}: ${d.folder}`);
  if (!dir) continue;
  const pdf = walk(dir).find((p) => /application_(info_\d+|KJET-[^\/]+)\.pdf$/i.test(p));
  check('the folder holds the application form', !!pdf, `${f.applicant_id} ${d.folder}`);
  if (!pdf) continue;
  const text = squash(execFileSync('pdftotext', ['-enc', 'UTF-8', pdf, '-'], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8'));
  for (const q of d.questions ?? []) {
    check('form: the question is in the PDF', text.includes(squash(q.question).slice(0, 40)), `${f.applicant_id} ${f.cluster_name} Q${q.n}: ${q.question.slice(0, 70)}`);
    const a = squash(q.answer);
    if (a === '') continue;
    answers++;
    check('form: the answer shown is in the PDF', text.includes(a), `${f.applicant_id} ${f.cluster_name} Q${q.n} "${q.question.slice(0, 50)}": ${String(q.answer).slice(0, 90)}`);
  }
  // members and employees by year, shown from the form, appear in the PDF as digits
  for (const [k, obj] of [['members', d.form.members], ['employees', d.form.employees]]) for (const [y, v] of Object.entries(obj ?? {})) if (v != null) check(`form: ${k} ${y} is in the PDF`, new RegExp(`(^|[^0-9])${String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',?')}([^0-9]|$)`).test(execFileSync('pdftotext', [pdf, '-']).toString('utf8')), `${f.applicant_id}: ${k} ${y}=${v}`);
}
console.log(`${api.rows.length} finalist forms read with pdftotext; ${answers} non-empty answers looked up\n`);
const bad = report('Cohort 1 application forms');
process.exit(bad ? 1 : 0);
