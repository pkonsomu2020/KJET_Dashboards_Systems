/**
 * evaluationSheet.js
 *
 * Keeps the evaluation results in step with the online Google Sheet (the Co-Investment Evaluation
 * Tool). The sheet's modified time is checked every EVALUATION_POLL_SECONDS (default 15). A change is
 * imported once it has stayed the same for a further poll, so a half-finished edit is not imported.
 * The import is one transaction: if the sheet is mid-edit or its layout is broken, the previous
 * evaluation stays in place and the problem is logged.
 *
 * Needs EVALUATION_SHEET_ID and the Drive service account (the sheet must be shared with it).
 */
import pool from '../db/pool.js';
import { cacheInvalidate } from '../cache/redis.js';
import { getDriveClient } from './driveService.js';
import { importEvaluation, ensureEvaluationSchema } from './evaluationImport.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

let notifier = null;
/** Called after each successful import so open dashboards can refresh at once. */
export const setEvaluationNotifier = (fn) => { notifier = fn; };

const status = {
  enabled: false, sheet_name: null, sheet_modified: null, last_checked: null,
  last_imported: null, last_error: null, imported_clusters: null,
};
export const getEvaluationSheetStatus = () => ({ ...status });

let importedModified = null;   // modified time of the version now in the database
let pendingModified = null;    // a newer version seen once, waiting for it to settle
let busy = false;

export async function syncEvaluationSheet({ force = false } = {}) {
  const drive = getDriveClient();
  const id = process.env.EVALUATION_SHEET_ID;
  if (!drive || !id || busy) return null;
  busy = true;
  try {
    const { data: meta } = await drive.files.get({ fileId: id, fields: 'name,modifiedTime', supportsAllDrives: true });
    status.sheet_name = meta.name;
    status.sheet_modified = meta.modifiedTime;
    status.last_checked = new Date().toISOString();

    if (!force && meta.modifiedTime === importedModified) { pendingModified = null; return null; }
    if (!force && pendingModified !== meta.modifiedTime) { pendingModified = meta.modifiedTime; return null; }   // wait for it to settle

    const res = await drive.files.export({ fileId: id, mimeType: XLSX_MIME }, { responseType: 'arraybuffer' });
    const r = await importEvaluation(pool, { buffer: Buffer.from(res.data), name: `${meta.name} (online sheet)` });
    await Promise.allSettled([cacheInvalidate('clusters:list:*'), cacheInvalidate('cluster:detail:*'), cacheInvalidate('evaluation:*')]);
    importedModified = meta.modifiedTime;
    pendingModified = null;
    status.last_imported = new Date().toISOString();
    status.last_error = null;
    status.imported_clusters = r.imported;
    try { notifier?.(); } catch { /* nobody listening */ }
    console.log(`[Evaluation] Imported ${r.imported} clusters from the online sheet, modified ${meta.modifiedTime}`);
    return r;
  } catch (err) {
    status.last_error = err.message;
    console.error('[Evaluation] Online sheet sync failed (previous results kept):', err.message);
    return null;
  } finally {
    busy = false;
  }
}

export async function startEvaluationSheetSync() {
  if (!process.env.EVALUATION_SHEET_ID || !getDriveClient()) {
    console.log('[Evaluation] Online sheet sync off (set EVALUATION_SHEET_ID to turn it on)');
    return;
  }
  status.enabled = true;
  await ensureEvaluationSchema(pool);
  await syncEvaluationSheet({ force: true });
  const every = Math.max(10, Number(process.env.EVALUATION_POLL_SECONDS) || 15) * 1000;
  setInterval(() => { syncEvaluationSheet(); }, every).unref?.();
  console.log(`[Evaluation] Watching the online sheet every ${every / 1000}s`);
}
