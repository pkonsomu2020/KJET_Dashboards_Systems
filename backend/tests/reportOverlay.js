// Applies the selection report's values (src/data/reportSnapshot.json) onto a workbook read for a test, so the tests
// compare the dashboard with "the live sheet, except where the report is the reference".
import { readFileSync } from 'fs';
import { createRequire } from 'module';
const XLSX = createRequire(import.meta.url)('xlsx');
const REPORT = JSON.parse(readFileSync(new URL('../src/data/reportSnapshot.json', import.meta.url), 'utf8'));

export function overlayReport(wb) {
  const sc = wb.Sheets['SCORECARD'];
  const rows = XLSX.utils.sheet_to_json(sc, { header: 1, defval: '' });
  const heads = new Map(rows[4].map((h, i) => [String(h).replace(/\s+/g, ' ').trim(), i]));
  rows.forEach((r, ri) => {
    const pin = REPORT.scorecard[String(r[2]).trim()];
    if (!pin) return;
    for (const [h, v] of Object.entries(pin)) sc[XLSX.utils.encode_cell({ r: ri, c: heads.get(h) })] = { t: typeof v === 'number' ? 'n' : 's', v };
  });
  const el = wb.Sheets['Eligibility'];
  const er = XLSX.utils.sheet_to_json(el, { header: 1, defval: '' });
  const col = er[4].findIndex((h) => String(h).replace(/\s+/g, ' ').trim() === 'E3 decision');
  er.forEach((r, ri) => { if (String(r[1]).startsWith('KJET-')) el[XLSX.utils.encode_cell({ r: ri, c: col })] = { t: 's', v: REPORT.eligibility.E3 }; });
  return wb;
}
