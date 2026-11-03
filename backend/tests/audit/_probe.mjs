import 'dotenv/config'; import { createRequire } from 'module'; import { readFileSync } from 'fs';
import { initDriveClient, getDriveClient } from '../../src/services/driveService.js';
const XLSX = createRequire(import.meta.url)('xlsx');
await initDriveClient(); const drive = getDriveClient();
const wb = XLSX.read(Buffer.from((await drive.files.export({ fileId: process.env.EVALUATION_SHEET_ID, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, { responseType: 'arraybuffer' })).data), { type: 'buffer' });
const fs = XLSX.utils.sheet_to_json(wb.Sheets['Financial_Screening'], { header: 1, defval: '' });
const h = fs[4].map((x) => String(x).replace(/\s+/g, ' ').trim()); const ci = (s) => h.findIndex((x) => x.startsWith(s));
const C = { app: ci('Application No.'), total: ci('Total investment (Evaluation'), contrib: ci('Cluster contribution (Evaluation'), grant: ci('KJET matching contribution (Evaluation'), s5: ci('Section 5 budget total (portal)') };
const live = JSON.parse(readFileSync(process.env.AUDIT_CACHE, 'utf8'));
let n = 0;
for (const r of fs.slice(5).filter((r) => String(r[C.app]).startsWith('KJET-'))) {
  const a = String(r[C.app]).trim(), d = live.detail[a];
  const diffs = [['cost', r[C.total], d.total_project_cost], ['grant', r[C.grant], d.grant_requested], ['cash', r[C.contrib], d.cluster_contribution], ['s5', r[C.s5], d.section5_budget_total]].filter(([, s, p]) => s !== '' && Math.abs(Number(s) - Number(p)) > 1);
  if (diffs.length) { n++; console.log(a, d.cluster_name.slice(0, 30).padEnd(30), diffs.map(([k, s, p]) => `${k}: sheet ${s} / profile ${p}`).join(' | ')); }
}
console.log(n, 'clusters whose profile amounts differ from the evaluation sheet (overview totals follow the sheet)');
