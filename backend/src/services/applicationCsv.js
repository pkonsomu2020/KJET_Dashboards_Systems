/**
 * applicationCsv.js
 *
 * Parser for the MIS export "application_details.csv" that sits at the root of every
 * cluster's Drive folder. The file is NOT standard CSV: it is "Label,value" lines where a
 * value may continue over several following lines (unquoted). A line starts a new field
 * only when the text before its first comma is a known label (src/data/csvLabels.json,
 * harvested from the 85 Cohort 1 files); every other line continues the previous value.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const LABELS = new Set(JSON.parse(readFileSync(join(here, '../data/csvLabels.json'), 'utf8')));

// Numbered families can grow without notice (Machinery 17, Service 8, ...): recognise them by shape,
// so a rare label never gets swallowed into the previous field.
const FAMILY = /^(Machinery|Service|Product|Buyer|Activity|Item|Commitment|Vehicle|Key assumption|Goal|Competitor) \d+( [A-Za-z0-9 ]{1,40})?$/;
const isLabel = (label) => LABELS.has(label) || FAMILY.test(label);

/** Returns a Map of label -> value (first occurrence wins; blank values kept as ''). */
export function parseApplicationCsv(text) {
  const fields = new Map();
  let current = null;
  for (const line of String(text).replace(/^﻿/, '').split(/\r?\n/)) {
    const i = line.indexOf(',');
    const label = i > 0 ? line.slice(0, i) : null;
    if (label && isLabel(label)) {
      current = label;
      if (!fields.has(label)) fields.set(label, line.slice(i + 1));
      else current = null; // duplicate label: ignore it and its continuation lines
    } else if (/^=== /.test(line) || line.trim() === '') {
      if (/^=== /.test(line)) current = null;
      else if (current) fields.set(current, fields.get(current) + '\n');
    } else if (current) {
      fields.set(current, fields.get(current) + '\n' + line);
    }
  }
  for (const [k, v] of fields) fields.set(k, v.replace(/\s+$/, '').trim());
  return fields;
}

/** Numeric value of a field, or null when blank/unparseable. */
export function num(fields, label) {
  const v = fields.get(label);
  if (v === undefined || v === '') return null;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

export function text(fields, label) {
  const v = fields.get(label);
  return v === undefined || v === '' ? null : v;
}

export const csvLabelCount = LABELS.size;
