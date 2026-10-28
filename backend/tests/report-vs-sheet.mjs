/**
 * report-vs-sheet.mjs: compares the selection report's Annex B with the live Google Sheet itself (not the dashboard). Read-only.
 *
 *   node tests/report-vs-sheet.mjs <tables.json>
 */
import 'dotenv/config';
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { initDriveClient, getDriveClient } from '../src/services/driveService.js';

const XLSX = createRequire(import.meta.url)('xlsx');
const T = JSON.parse(readFileSync(process.argv[2], 'utf8'));
await initDriveClient();
const drive = getDriveClient();
const id = process.env.EVALUATION_SHEET_ID;
const { data: meta } = await drive.files.get({ fileId: id, fields: 'name,modifiedTime', supportsAllDrives: true });
const res = await drive.files.export({ fileId: id, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, { responseType: 'arraybuffer' });
const wb = XLSX.read(Buffer.from(res.data), { type: 'buffer', cellDates: false });
console.log(`Sheet: ${meta.name}, modified ${meta.modifiedTime}\n`);

const grid = (name) => XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
const norm = (h) => String(h).replace(/\s+/g, ' ').trim();
const col = (head, name) => head.map(norm).findIndex((h) => h.startsWith(name));
const num = (v) => { const x = Number(String(v ?? '').replace(/[,\s]/g, '')); return String(v ?? '').trim() === '' || !Number.isFinite(x) ? null : x; };

const sc = grid('SCORECARD'), sh = sc[4];
const cApp = col(sh, 'Application No.'), cScore = col(sh, 'TOTAL SCORE'), cBand = col(sh, 'Decision band'), cElig = col(sh, 'Eligibility status');
const S = new Map(sc.slice(5).filter((r) => String(r[cApp]).startsWith('KJET-')).map((r) => [String(r[cApp]).trim(), r]));

const fs = grid('Financial_Screening'), fh = fs[4];
const fApp = col(fh, 'Application No.'), fT = col(fh, 'Total investment (Evaluation'), fC = col(fh, 'Cluster contribution (Evaluation'), fG = col(fh, 'KJET matching contribution (Evaluation');
const F = new Map(fs.slice(5).filter((r) => String(r[fApp]).startsWith('KJET-')).map((r) => [String(r[fApp]).trim(), r]));

const window = (g) => (g == null ? '-' : g <= 0 ? '-' : g <= 5000000 ? '1' : g <= 32000000 ? '2' : '-');
const BANDS = { 'Table 23': 'Recommended', 'Table 24': 'Referred with Comments', 'Table 25': 'Rejected' };
const diffs = [];
const tally = { score: 0, band: 0, elig: 0, grant: 0, window: 0 }; let seen = 0;
let repGrant = 0, shGrant = 0, shTotal = 0;
for (const [tk, band] of Object.entries(BANDS)) {
  for (const r of T[tk].slice(1)) {
    seen++;
    const app = r[1], s = S.get(app), f = F.get(app);
    if (!s || !f) { diffs.push(`${app}: not in the sheet`); continue; }
    const rg = num(r[8]), sg = num(f[fG]);
    repGrant += rg ?? 0; shGrant += sg ?? 0; shTotal += num(f[fT]) ?? 0;
    const ok = (k, cond, msg) => { if (cond) tally[k]++; else diffs.push(`${r[2] ?? app} (${app}): ${msg}`); };
    ok('score', Math.abs(num(r[6]) - num(s[cScore])) < 0.0001, `score report ${r[6]} | sheet ${s[cScore]}`);
    ok('band', norm(s[cBand]) === band, `band report ${band} | sheet ${s[cBand]}`);
    ok('elig', String(r[7]).toUpperCase() === norm(s[cElig]).toUpperCase(), `eligibility report ${r[7]} | sheet ${s[cElig]}`);
    ok('grant', rg != null && sg != null && Math.abs(rg - sg) <= 0.5, `grant report ${rg} | sheet ${sg} (total ${num(f[fT])}, cash ${num(f[fC])})`);
    ok('window', String(r[5]) === window(sg), `window report ${r[5]} | sheet amount gives ${window(sg)}`);
  }
}
console.log(`Clusters in the report: ${seen}; in the sheet: ${S.size}`);
for (const [k, v] of Object.entries(tally)) console.log(`${k.padEnd(7)} ${v}/${seen} agree`);
console.log(`\nGrant total: report ${(repGrant / 1e6).toFixed(1)}m | sheet ${(shGrant / 1e6).toFixed(1)}m; sheet project cost total ${(shTotal / 1e6).toFixed(1)}m`);
console.log(`\n${diffs.length} differences:\n` + diffs.join('\n'));
process.exit(0);
