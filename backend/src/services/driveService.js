/**
 * driveService.js
 *
 * Connects to Google Drive API using a Service Account and provides:
 *   1. Recursive traversal of all folders, subfolders, and files at any depth
 *   2. Full content extraction for Excel (.xlsx/.xls/.csv), Google Sheets,
 *      Word (.docx), Google Docs, PDFs (.pdf), and text/JSON documents
 *   3. Automatic extraction of KJET application metrics from folder documents
 *      and synchronization into PostgreSQL (clusters, financials, membership,
 *      employment, business, machinery, services, contacts, banking, documents)
 *   4. Background 30s Drive changes poller that automatically re-syncs affected
 *      clusters and broadcasts live SSE updates to all connected dashboard tabs
 */

import { google } from 'googleapis';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import pool from '../db/pool.js';
import { cacheGet, cacheSet, cacheInvalidate } from '../cache/redis.js';

const require = createRequire(import.meta.url);
let pdfParse = null;
try {
  pdfParse = require('pdf-parse');
} catch {
  // Optional fallback if pdf-parse fails to load
}

// Lazy import to avoid circular dependency with index.js
async function broadcast(folderIds, applicationNumbers = []) {
  try {
    const { broadcastDriveChange } = await import('../index.js');
    broadcastDriveChange(folderIds, applicationNumbers);
  } catch { /* SSE not yet ready */ }
}

const __dir = dirname(fileURLToPath(import.meta.url));
const SA_PATH = process.env.GOOGLE_SERVICE_ACCOUNT_PATH
  ? resolve(process.env.GOOGLE_SERVICE_ACCOUNT_PATH)
  : resolve(__dir, '../../service-account.json');

// TTL for folder content cache (25 seconds)
const FOLDER_CACHE_TTL = 25;
// Poll Drive for changes every 30 seconds
const POLL_INTERVAL_MS = 30_000;

let driveClient = null;
let changesStartPageToken = null;
let lastSyncTime = null;
let pollerTimer = null;
let driveEnabled = false;

// Map of subfolderId -> root cluster application_number for fast change resolution
const folderToClusterMap = new Map();

// ── File type categorization ──────────────────────────────────
const FILE_TYPE_MAP = {
  'application/pdf':                                                        { type: 'PDF',          icon: 'file-text', readable: true },
  'application/vnd.ms-excel':                                               { type: 'Excel',        icon: 'table',     readable: true },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':      { type: 'Excel',        icon: 'table',     readable: true },
  'text/csv':                                                               { type: 'CSV',          icon: 'table',     readable: true },
  'application/vnd.ms-word':                                                { type: 'Word',         icon: 'file',      readable: true },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':{ type: 'Word',         icon: 'file',      readable: true },
  'application/vnd.google-apps.document':                                   { type: 'Google Doc',   icon: 'file',      readable: true },
  'application/vnd.google-apps.spreadsheet':                                { type: 'Google Sheet', icon: 'table',     readable: true },
  'text/plain':                                                             { type: 'Text',         icon: 'file-text', readable: true },
  'application/json':                                                       { type: 'JSON',         icon: 'file-text', readable: true },
  'image/jpeg':                                                             { type: 'Image',        icon: 'image',     readable: false },
  'image/png':                                                              { type: 'Image',        icon: 'image',     readable: false },
  'image/heic':                                                             { type: 'Image',        icon: 'image',     readable: false },
  'application/vnd.google-apps.folder':                                     { type: 'Folder',       icon: 'folder',    readable: false },
};

function categorizeFile(mimeType, name = '') {
  if (FILE_TYPE_MAP[mimeType]) return FILE_TYPE_MAP[mimeType];
  const ext = extname(name).toLowerCase();
  if (['.xlsx', '.xls', '.csv'].includes(ext)) return { type: 'Excel', icon: 'table', readable: true };
  if (['.docx', '.doc'].includes(ext))         return { type: 'Word',  icon: 'file',  readable: true };
  if (ext === '.pdf')                          return { type: 'PDF',   icon: 'file-text', readable: true };
  if (['.txt', '.md', '.json'].includes(ext))  return { type: 'Text',  icon: 'file-text', readable: true };
  return { type: 'File', icon: 'file', readable: false };
}

// ── Initialize Drive client ───────────────────────────────────
export async function initDriveClient() {
  if (!existsSync(SA_PATH)) {
    console.warn(`[Drive] Service account file not found at: ${SA_PATH}`);
    console.warn('[Drive] Drive integration disabled. See DRIVE_SETUP.md to enable it.');
    driveEnabled = false;
    return false;
  }

  try {
    const key = JSON.parse(readFileSync(SA_PATH, 'utf8'));
    const auth = new google.auth.GoogleAuth({
      credentials: key,
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });
    driveClient = google.drive({ version: 'v3', auth });

    // Get initial page token for changes feed
    const { data } = await driveClient.changes.getStartPageToken();
    changesStartPageToken = data.startPageToken;
    driveEnabled = true;
    console.log('[Drive] Connected — service account authenticated');
    return true;
  } catch (err) {
    console.error('[Drive] Failed to initialize:', err.message);
    driveEnabled = false;
    return false;
  }
}

export function isDriveEnabled() { return driveEnabled; }
export function getLastSyncTime() { return lastSyncTime; }

// ── Extract folder ID from Drive URL ─────────────────────────
export function extractFolderId(driveUrl) {
  if (!driveUrl) return null;
  const match = driveUrl.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

// ── List files in a single Drive folder (with Redis cache) ────
export async function listFolderFiles(folderId, forceRefresh = false) {
  if (!driveEnabled || !folderId) return { files: [], cached: false, error: null };

  const cacheKey = `drive:folder:${folderId}`;

  if (!forceRefresh) {
    const cached = await cacheGet(cacheKey);
    if (cached) return { ...cached, cached: true };
  }

  try {
    const { data } = await driveClient.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'files(id, name, mimeType, size, modifiedTime, webViewLink, webContentLink, thumbnailLink)',
      orderBy: 'folder, name',
      pageSize: 200,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    const files = (data.files ?? []).map(f => {
      const { type, icon, readable } = categorizeFile(f.mimeType, f.name);
      return {
        id:           f.id,
        name:         f.name,
        mimeType:     f.mimeType,
        type,
        icon,
        readable,
        size:         f.size ? formatBytes(Number(f.size)) : null,
        modifiedTime: f.modifiedTime,
        viewUrl:      f.webViewLink,
        downloadUrl:  f.webContentLink ?? null,
        thumbnail:    f.thumbnailLink  ?? null,
        isFolder:     f.mimeType === 'application/vnd.google-apps.folder',
      };
    });

    const result = { files, cached: false, error: null, fetchedAt: new Date().toISOString() };
    await cacheSet(cacheKey, result, FOLDER_CACHE_TTL);
    return result;
  } catch (err) {
    console.error(`[Drive] listFolderFiles error for ${folderId}:`, err.message);
    return { files: [], cached: false, error: err.message };
  }
}

// ── Recursively list all folders & nested subfolders at any depth ─
export async function listSubfolderContents(folderId, forceRefresh = false, applicationNumber = null) {
  if (!driveEnabled || !folderId) return [];
  if (applicationNumber) folderToClusterMap.set(folderId, applicationNumber);

  const sections = [];

  async function walk(currentFolderId, pathPrefix, depth = 0) {
    if (depth > 6) return; // safety guard against circular shortcuts
    if (applicationNumber) folderToClusterMap.set(currentFolderId, applicationNumber);

    const listing = await listFolderFiles(currentFolderId, forceRefresh);
    const directFiles = listing.files.filter(f => !f.isFolder);
    const subfolders  = listing.files.filter(f => f.isFolder);

    if (directFiles.length > 0) {
      sections.push({
        sectionName: pathPrefix || 'Root',
        folderId:    currentFolderId,
        files:       directFiles,
      });
    }

    for (const sub of subfolders) {
      const nextPrefix = pathPrefix ? `${pathPrefix} / ${sub.name}` : sub.name;
      await walk(sub.id, nextPrefix, depth + 1);
    }
  }

  await walk(folderId, '');
  return sections;
}

// ── Download raw file buffer from Google Drive ────────────────
async function downloadDriveFileBuffer(fileId, mimeType) {
  if (!driveEnabled || !driveClient) throw new Error('Drive client not enabled');

  // Google Workspace native files must be exported
  if (mimeType === 'application/vnd.google-apps.spreadsheet') {
    const res = await driveClient.files.export(
      { fileId, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      { responseType: 'arraybuffer' },
    );
    return {
      buffer: Buffer.from(res.data),
      effectiveMime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  if (mimeType === 'application/vnd.google-apps.document') {
    const res = await driveClient.files.export(
      { fileId, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      { responseType: 'arraybuffer' },
    );
    return {
      buffer: Buffer.from(res.data),
      effectiveMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
  }

  const res = await driveClient.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' },
  );
  return { buffer: Buffer.from(res.data), effectiveMime: mimeType };
}

// ── Read & parse the full content of any Drive file ───────────
export async function readDriveFileContent(fileId, forceRefresh = false) {
  if (!driveEnabled) throw new Error('Drive integration is not enabled');

  const cacheKey = `drive:filecontent:${fileId}`;
  if (!forceRefresh) {
    const cached = await cacheGet(cacheKey);
    if (cached) return { ...cached, cached: true };
  }

  // 1. Get file metadata
  const { data: meta } = await driveClient.files.get({
    fileId,
    fields: 'id, name, mimeType, size, modifiedTime, webViewLink',
    supportsAllDrives: true,
  });

  const { type } = categorizeFile(meta.mimeType, meta.name);
  const { buffer, effectiveMime } = await downloadDriveFileBuffer(fileId, meta.mimeType);

  let text = '';
  let sheets = [];
  let keyValues = {};

  // Excel / Google Sheet / CSV
  if (
    type === 'Excel' ||
    type === 'Google Sheet' ||
    type === 'CSV' ||
    effectiveMime.includes('spreadsheet') ||
    effectiveMime.includes('excel') ||
    effectiveMime === 'text/csv'
  ) {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const textParts = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
        .filter(row => Array.isArray(row) && row.some(cell => String(cell).trim() !== ''));

      sheets.push({
        name: sheetName,
        rows: rows.slice(0, 250).map(r => r.map(c => (c instanceof Date ? c.toISOString().slice(0, 10) : String(c ?? '')))),
      });

      // Extract key-value pairs from 2+ column rows
      for (const row of rows) {
        const nonEmpty = row.map(c => String(c ?? '').trim()).filter(Boolean);
        if (nonEmpty.length >= 2) {
          const k = nonEmpty[0].toLowerCase();
          if (k.length < 120) {
            keyValues[k] = nonEmpty.slice(1).join(' | ');
          }
        }
        if (nonEmpty.length > 0) {
          textParts.push(nonEmpty.join(' \t '));
        }
      }
    }
    text = textParts.join('\n');
  }
  // Word / Google Doc
  else if (
    type === 'Word' ||
    type === 'Google Doc' ||
    effectiveMime.includes('wordprocessingml') ||
    effectiveMime.includes('ms-word')
  ) {
    const result = await mammoth.extractRawText({ buffer });
    text = (result.value || '').trim();
    for (const line of text.split(/\r?\n/)) {
      const sepIdx = line.indexOf(':');
      if (sepIdx > 1 && sepIdx < 80) {
        const k = line.slice(0, sepIdx).trim().toLowerCase();
        const v = line.slice(sepIdx + 1).trim();
        if (k && v) keyValues[k] = v;
      }
    }
  }
  // PDF
  else if (type === 'PDF' || effectiveMime === 'application/pdf') {
    if (pdfParse) {
      const parsed = await pdfParse(buffer);
      text = (parsed.text || '').trim();
      for (const line of text.split(/\r?\n/)) {
        const sepIdx = line.indexOf(':');
        if (sepIdx > 1 && sepIdx < 80) {
          const k = line.slice(0, sepIdx).trim().toLowerCase();
          const v = line.slice(sepIdx + 1).trim();
          if (k && v) keyValues[k] = v;
        }
      }
    } else {
      text = 'PDF parser unavailable.';
    }
  }
  // Plain text / JSON
  else if (type === 'Text' || type === 'JSON' || effectiveMime.startsWith('text/') || effectiveMime === 'application/json') {
    text = buffer.toString('utf8');
  }

  const parsedResult = {
    id:           meta.id,
    name:         meta.name,
    mimeType:     meta.mimeType,
    type,
    size:         meta.size ? formatBytes(Number(meta.size)) : null,
    modifiedTime: meta.modifiedTime,
    viewUrl:      meta.webViewLink,
    text,
    sheets,
    keyValues,
    fetchedAt:    new Date().toISOString(),
  };

  await cacheSet(cacheKey, parsedResult, 60);
  return { ...parsedResult, cached: false };
}

// ── Numeric & text extraction helpers for KJET fields ─────────
function parseNum(val) {
  if (val === undefined || val === null || val === '') return null;
  const cleaned = String(val).replace(/kes|ksh|,|%|\s/gi, '').trim();
  const m = cleaned.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function findValueByPatterns(keyValues, patterns) {
  const entries = Object.entries(keyValues);
  for (const pattern of patterns) {
    for (const [k, v] of entries) {
      if (pattern.test(k) && v && String(v).trim() !== '') {
        // Pick first segment if pipe-delimited
        const firstVal = String(v).split('|')[0].trim();
        if (firstVal) return firstVal;
      }
    }
  }
  return null;
}

function findNumByPatterns(keyValues, patterns) {
  const entries = Object.entries(keyValues);
  for (const pattern of patterns) {
    for (const [k, v] of entries) {
      if (pattern.test(k)) {
        const parts = String(v).split('|');
        for (const part of parts) {
          const n = parseNum(part);
          if (n !== null && n >= 0) return n;
        }
      }
    }
  }
  return null;
}

// ── Full Cluster Sync: Read ALL Drive documents & update PostgreSQL ─
export async function syncClusterFromDrive(applicationNumber) {
  if (!driveEnabled) {
    return { ok: false, synced: false, message: 'Drive integration is not enabled' };
  }

  const { rows: clusterRows } = await pool.query(
    'SELECT id, application_number, cluster_name, google_drive_folder FROM clusters WHERE application_number = $1',
    [applicationNumber],
  );
  if (!clusterRows.length) {
    return { ok: false, synced: false, message: `Cluster ${applicationNumber} not found` };
  }

  const cluster = clusterRows[0];
  const folderId = extractFolderId(cluster.google_drive_folder);
  if (!folderId) {
    return { ok: false, synced: false, message: 'No valid Drive folder ID' };
  }

  // 1. Traverse all folders and subfolders (force fresh)
  const sections = await listSubfolderContents(folderId, true, applicationNumber);

  // 2. Read & parse every readable document in all sections
  const combinedKV = {};
  const allDocuments = [];
  const extractedMachinery = [];

  for (const section of sections) {
    for (const file of section.files) {
      const ext = extname(file.name).replace('.', '').toLowerCase() || file.type.toLowerCase();
      allDocuments.push({
        section:           section.sectionName.slice(0, 15),
        document_type:     file.type.slice(0, 60),
        original_filename: file.name,
        file_extension:    ext.slice(0, 10),
        google_drive_url:  file.viewUrl,
        folder_url:        cluster.google_drive_folder,
      });

      if (file.readable) {
        try {
          const parsed = await readDriveFileContent(file.id, true);
          Object.assign(combinedKV, parsed.keyValues);

          // Check sheets for itemized machinery tables
          for (const sheet of parsed.sheets || []) {
            for (const row of sheet.rows || []) {
              const first = String(row[0] ?? '').toLowerCase();
              if (
                row.length >= 3 &&
                !/^(item|s\/n|no|total|subtotal|description)/i.test(first) &&
                String(row[1] ?? '').trim().length > 3
              ) {
                const qty = parseNum(row[2]);
                const unitCost = parseNum(row[3]);
                const totalCost = parseNum(row[4]) ?? (qty && unitCost ? qty * unitCost : null);
                if (unitCost && unitCost > 1000 && extractedMachinery.length < 10) {
                  extractedMachinery.push({
                    description:    String(row[1]).trim(),
                    quantity:       qty ?? 1,
                    unit_cost_kes:  unitCost,
                    total_cost_kes: totalCost ?? unitCost,
                  });
                }
              }
            }
          }
        } catch (err) {
          console.warn(`[Drive Sync] Could not parse file ${file.name}:`, err.message);
        }
      }
    }
  }

  // 3. Extract structured fields if present in parsed documents
  const totalProjectCost    = findNumByPatterns(combinedKV, [/total eligible project cost/i, /total project cost/i, /section 3 total/i]);
  const grantRequested      = findNumByPatterns(combinedKV, [/kjet grant requested/i, /grant requested/i, /matching grant requested/i]);
  const clusterContribution = findNumByPatterns(combinedKV, [/cluster cash contribution/i, /cluster contribution/i, /applicant contribution/i]);
  const section5Budget      = findNumByPatterns(combinedKV, [/section 5.*budget/i, /total operational budget/i, /full project budget/i]);
  const totalMembers        = findNumByPatterns(combinedKV, [/total registered members/i, /total members/i, /number of members/i]);
  const womenMembers        = findNumByPatterns(combinedKV, [/^women$/i, /female members/i, /women members/i]);
  const menMembers          = findNumByPatterns(combinedKV, [/^men$/i, /male members/i, /men members/i]);
  const youthMembers        = findNumByPatterns(combinedKV, [/^youth$/i, /youth members/i]);
  const pwdMembers          = findNumByPatterns(combinedKV, [/persons with disabilities/i, /^pwd$/i, /pwd members/i]);
  const jobsToday           = findNumByPatterns(combinedKV, [/jobs today/i, /baseline jobs/i, /current jobs/i]);
  const jobsYear1           = findNumByPatterns(combinedKV, [/jobs year 1/i, /year 1 jobs/i]);
  const jobsYear3           = findNumByPatterns(combinedKV, [/jobs year 3/i, /year 3 jobs/i]);
  const businessDesc        = findValueByPatterns(combinedKV, [/business description/i, /business model/i]);
  const investmentNeeds     = findValueByPatterns(combinedKV, [/investment needs/i, /operational bottleneck/i, /main bottleneck/i]);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Sync cluster_documents table with actual live files from Drive
    if (allDocuments.length > 0) {
      await client.query('DELETE FROM cluster_documents WHERE cluster_id = $1', [cluster.id]);
      for (const doc of allDocuments) {
        await client.query(
          `INSERT INTO cluster_documents
             (cluster_id, section, document_type, original_filename, file_extension, google_drive_url, folder_url)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            cluster.id,
            doc.section,
            doc.document_type,
            doc.original_filename,
            doc.file_extension,
            doc.google_drive_url,
            doc.folder_url,
          ],
        );
      }
    }

    // Update financials if any financial figures were parsed from the documents
    if (totalProjectCost !== null || grantRequested !== null || clusterContribution !== null || section5Budget !== null) {
      await client.query(
        `UPDATE cluster_financials SET
           total_project_cost    = COALESCE($2, total_project_cost),
           grant_requested       = COALESCE($3, grant_requested),
           cluster_contribution  = COALESCE($4, cluster_contribution),
           section5_budget_total = COALESCE($5, section5_budget_total),
           grant_share_pct       = CASE
             WHEN COALESCE($2, total_project_cost) > 0
             THEN ROUND((COALESCE($3, grant_requested) / COALESCE($2, total_project_cost)) * 100, 2)
             ELSE grant_share_pct
           END,
           cluster_share_pct     = CASE
             WHEN COALESCE($2, total_project_cost) > 0
             THEN ROUND((COALESCE($4, cluster_contribution) / COALESCE($2, total_project_cost)) * 100, 2)
             ELSE cluster_share_pct
           END
         WHERE cluster_id = $1`,
        [cluster.id, totalProjectCost, grantRequested, clusterContribution, section5Budget],
      );
    }

    // Update membership if parsed
    if (totalMembers !== null || womenMembers !== null || menMembers !== null || youthMembers !== null || pwdMembers !== null) {
      await client.query(
        `UPDATE cluster_membership SET
           total_members = COALESCE($2, total_members),
           women         = COALESCE($3, women),
           men           = COALESCE($4, men),
           youth         = COALESCE($5, youth),
           pwd           = COALESCE($6, pwd)
         WHERE cluster_id = $1`,
        [cluster.id, totalMembers, womenMembers, menMembers, youthMembers, pwdMembers],
      );
    }

    // Update employment if parsed
    if (jobsToday !== null || jobsYear1 !== null || jobsYear3 !== null) {
      await client.query(
        `UPDATE cluster_employment SET
           jobs_today = COALESCE($2, jobs_today),
           jobs_year1 = COALESCE($3, jobs_year1),
           jobs_year3 = COALESCE($4, jobs_year3)
         WHERE cluster_id = $1`,
        [cluster.id, jobsToday, jobsYear1, jobsYear3],
      );
    }

    // Update business narrative if parsed
    if (businessDesc || investmentNeeds) {
      await client.query(
        `UPDATE cluster_business SET
           business_description = COALESCE($2, business_description),
           investment_needs     = COALESCE($3, investment_needs)
         WHERE cluster_id = $1`,
        [cluster.id, businessDesc, investmentNeeds],
      );
    }

    await client.query('UPDATE clusters SET updated_at = NOW() WHERE id = $1', [cluster.id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // 4. Invalidate all portfolio & cluster caches so the dashboard updates immediately
  await Promise.all([
    cacheInvalidate('portfolio:*'),
    cacheInvalidate('clusters:list:*'),
    cacheInvalidate(`cluster:detail:${applicationNumber}`),
  ]);

  return {
    ok:            true,
    synced:        true,
    applicationNumber,
    filesScanned:  allDocuments.length,
    sectionsCount: sections.length,
    syncedAt:      new Date().toISOString(),
  };
}

// ── Background poller — runs every 30 seconds ─────────────────
async function pollChanges() {
  if (!driveEnabled || !changesStartPageToken) return;

  try {
    const { data } = await driveClient.changes.list({
      pageToken: changesStartPageToken,
      fields: 'nextPageToken, newStartPageToken, changes(fileId, file(name, parents, mimeType))',
      spaces: 'drive',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    if (data.changes && data.changes.length > 0) {
      const changedFolderIds = new Set();
      const affectedAppNumbers = new Set();

      for (const change of data.changes) {
        if (change.fileId) await cacheInvalidate(`drive:filecontent:${change.fileId}`);
        const parents = change.file?.parents ?? [];
        for (const p of parents) {
          changedFolderIds.add(p);
          if (folderToClusterMap.has(p)) {
            affectedAppNumbers.add(folderToClusterMap.get(p));
          }
        }
        if (change.file?.mimeType === 'application/vnd.google-apps.folder') {
          changedFolderIds.add(change.fileId);
          if (folderToClusterMap.has(change.fileId)) {
            affectedAppNumbers.add(folderToClusterMap.get(change.fileId));
          }
        }
      }

      if (changedFolderIds.size > 0) {
        for (const folderId of changedFolderIds) {
          await cacheInvalidate(`drive:folder:${folderId}`);
        }

        // Also match root cluster folders in DB if not yet in folderToClusterMap
        const { rows: allClusters } = await pool.query(
          'SELECT application_number, google_drive_folder FROM clusters WHERE google_drive_folder IS NOT NULL',
        );
        for (const c of allClusters) {
          const rootId = extractFolderId(c.google_drive_folder);
          if (rootId && changedFolderIds.has(rootId)) {
            affectedAppNumbers.add(c.application_number);
          }
        }

        // Automatically re-read and sync every affected cluster from Drive into PostgreSQL
        for (const appNum of affectedAppNumbers) {
          try {
            await syncClusterFromDrive(appNum);
            console.log(`[Drive] Auto-synced cluster ${appNum} from updated Drive files`);
          } catch (err) {
            console.warn(`[Drive] Failed auto-sync for ${appNum}:`, err.message);
          }
        }

        console.log(`[Drive] ${data.changes.length} changes detected — invalidated ${changedFolderIds.size} folders, synced ${affectedAppNumbers.size} clusters`);
        lastSyncTime = new Date().toISOString();

        const changedArray = [...changedFolderIds];
        await cacheSet('drive:changed_folders', changedArray, 60);

        // Push to all connected browser tabs via SSE immediately
        await broadcast(changedArray, [...affectedAppNumbers]);
      }
    }

    if (data.newStartPageToken) changesStartPageToken = data.newStartPageToken;
    else if (data.nextPageToken)  changesStartPageToken = data.nextPageToken;

    lastSyncTime = new Date().toISOString();
  } catch (err) {
    console.error('[Drive] pollChanges error:', err.message);
  }
}

export function startChangesPoller() {
  if (!driveEnabled) return;
  if (pollerTimer) clearInterval(pollerTimer);
  pollerTimer = setInterval(pollChanges, POLL_INTERVAL_MS);
  console.log(`[Drive] Changes poller started — checking every ${POLL_INTERVAL_MS / 1000}s`);
}

export function stopChangesPoller() {
  if (pollerTimer) { clearInterval(pollerTimer); pollerTimer = null; }
}

// ── Helper ────────────────────────────────────────────────────
function formatBytes(bytes) {
  if (!bytes) return null;
  if (bytes < 1024)       return `${bytes} B`;
  if (bytes < 1024 ** 2)  return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3)  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
