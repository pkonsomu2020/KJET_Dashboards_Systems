/**
 * application-csv.test.js: the application_details.csv reader. A line that opens a document field ("Technical specs[],[...paths]",
 * the form the newer exports use) must end the field before it, so file paths never appear inside "Why now" or "Key assumption 5".
 *
 *   node tests/application-csv.test.js
 */
import assert from 'node:assert/strict';
import { parseApplicationCsv } from '../src/services/applicationCsv.js';

const f = parseApplicationCsv([
  'Why now,because the market is growing', 'and demand rises',
  'Technical specs[],["co-investment/KJET-2026-1/section_3/a.pdf"]', 'Supplier quotations[],["b.pdf"]',
  'Key assumption 5,', 'Bank statements[],["co-investment/KJET-2026-1/section_5/c.pdf"]', 'Financial statements,[[]] (see files folder)', '',
].join('\n'));
assert.equal(f.get('Why now'), 'because the market is growing\nand demand rises');
assert.equal(f.get('Key assumption 5'), '');
assert.equal(f.get('Technical specs'), '["co-investment/KJET-2026-1/section_3/a.pdf"]');
console.log('application-csv: 4 checks passed');
