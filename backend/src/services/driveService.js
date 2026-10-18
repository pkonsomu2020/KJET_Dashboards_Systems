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
import { parseApplicationCsv } from './applicationCsv.js';
import { applyApplicationCsv, ensureSyncSchemaOnce } from './applicationSync.js';
import { extractTextInWorker } from './documentPool.js';
import { extractorVersion } from './documentExtract.js';
import { cacheGet, cacheSet, cacheInvalidate } from '../cache/redis.js';

const require = createRequire(import.meta.url);
// pdf-parse v2 exports a PDFParse class (v1 exported a function).
let PDFParse = null;
try {
  PDFParse = require('pdf-parse').PDFParse;
} catch {
  // Optional fallback if pdf-parse fails to load
}

// The API server registers its SSE broadcaster here (no import of index.js, which would start a second server).
let broadcaster = null;
export function setBroadcaster(fn) { broadcaster = fn; }

async function broadcast(folderIds, applicationNumbers = []) {
  try { broadcaster?.(folderIds, applicationNumbers); } catch { /* SSE not ready */ }
}

const __dir = dirname(fileURLToPath(import.meta.url));
const SA_PATH = process.env.GOOGLE_SERVICE_ACCOUNT_PATH
  ? resolve(process.env.GOOGLE_SERVICE_ACCOUNT_PATH)
  : resolve(__dir, '../../service-account.json');

// TTL for folder content cache (25 seconds)
const FOLDER_CACHE_TTL = 25;
// Poll Drive for changes every 30 seconds
// (configurable; 10s keeps edit-to-database latency well inside 30s even with the sync itself taking a few seconds)
const POLL_INTERVAL_MS = Math.max(5, Number(process.env.DRIVE_POLL_SECONDS) || 10) * 1000;

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
    // Page through the whole folder: a single page would silently drop files in large folders
    const rawFiles = [];
    let pageToken;
    do {
      const { data } = await driveClient.files.list({
        q: `'${String(folderId).replace(/['\\]/g, '')}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id, name, mimeType, size, md5Checksum, modifiedTime, webViewLink, webContentLink, thumbnailLink)',
        orderBy: 'folder, name',
        pageSize: 200,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      rawFiles.push(...(data.files ?? []));
      pageToken = data.nextPageToken;
    } while (pageToken);

    const files = rawFiles.map(f => {
      const { type, icon, readable } = categorizeFile(f.mimeType, f.name);
      return {
        id:           f.id,
        name:         f.name,
        mimeType:     f.mimeType,
        type,
        icon,
        readable,
        size:         f.size ? formatBytes(Number(f.size)) : null,
        sizeBytes:    f.size ? Number(f.size) : null,
        md5:          f.md5Checksum ?? null,
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
    // A failed listing must abort the sync: treating it as "empty folder" would delete stored documents
    if (listing.error) throw new Error(`Drive listing failed for folder ${currentFolderId}: ${listing.error}`);
    const directFiles = listing.files.filter(f => !f.isFolder);
    const subfolders  = listing.files.filter(f => f.isFolder);

    if (directFiles.length > 0) {
      sections.push({
        sectionName: pathPrefix || 'Root',
        folderId:    currentFolderId,
        files:       directFiles,
      });
    }

    // Subfolders are independent: scan them in parallel (sequential scanning dominated sync time)
    await Promise.all(subfolders.map((sub) => {
      const nextPrefix = pathPrefix ? `${pathPrefix} / ${sub.name}` : sub.name;
      return walk(sub.id, nextPrefix, depth + 1);
    }));
  }

  await walk(folderId, '');
  sections.sort((a, b) => a.sectionName.localeCompare(b.sectionName));
  return sections;
}

// ── Download raw file buffer from Google Drive ────────────────
export async function downloadDriveFileBuffer(fileId, mimeType) {
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

/** Downloads and parses the root application_details.csv of a cluster's Drive folder. */
export async function readApplicationCsvFromDrive(rootFolderId) {
  const listing = await listFolderFiles(rootFolderId, true);
  if (listing.error) throw new Error(`Drive listing failed: ${listing.error}`);
  const file = listing.files.find((f) => /^application_details\.csv$/i.test(f.name));
  if (!file) return null;
  const { buffer } = await downloadDriveFileBuffer(file.id, file.mimeType);
  return { file, fields: parseApplicationCsv(buffer.toString('utf8')) };
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
    if (PDFParse) {
      const parser = new PDFParse({ data: buffer });
      try {
        const parsed = await parser.getText();
        text = (parsed.text || '').trim();
      } finally {
        await parser.destroy().catch(() => {});
      }
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

// ── Cluster sync: Drive application_details.csv is the single source of truth ──
// Every value in the CSV replaces what PostgreSQL holds (see applicationSync.js).
// Nothing is inferred from PDFs. One sync per cluster runs at a time; a change that
// arrives mid-sync queues exactly one follow-up run.
const syncInFlight = new Map();
const syncQueued = new Set();

export function syncClusterFromDrive(applicationNumber) {
  if (syncInFlight.has(applicationNumber)) {
    syncQueued.add(applicationNumber);
    return syncInFlight.get(applicationNumber);
  }
  const p = runClusterSync(applicationNumber).finally(() => {
    syncInFlight.delete(applicationNumber);
    if (syncQueued.delete(applicationNumber)) {
      syncClusterFromDrive(applicationNumber).catch((err) =>
        console.warn(`[Drive Sync] Follow-up sync failed for ${applicationNumber}:`, err.message));
    }
  });
  syncInFlight.set(applicationNumber, p);
  return p;
}

async function runClusterSync(applicationNumber) {
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

  // 1. Read the authoritative file. If it is missing or unreadable the database is left untouched.
  // The CSV read and the folder scan (file inventory for the Documents tab) are independent Drive
  // calls, so run them together.
  let csv;
  let sections;
  try {
    [csv, sections] = await Promise.all([
      readApplicationCsvFromDrive(folderId),
      listSubfolderContents(folderId, true, applicationNumber),
    ]);
  } catch (err) {
    return { ok: false, synced: false, message: err.message };
  }
  if (!csv) {
    return { ok: false, synced: false, message: 'application_details.csv not found in the Drive folder' };
  }
  // 2. Every file in every section folder
  const allDocuments = [];
  for (const section of sections) {
    for (const file of section.files) {
      allDocuments.push({
        file_id:           file.id,
        section:           section.sectionName,
        document_type:     file.type.slice(0, 60),
        original_filename: file.name,
        file_extension:    (extname(file.name).replace('.', '').toLowerCase() || file.type.toLowerCase()).slice(0, 10),
        google_drive_url:  file.viewUrl,
        folder_url:        cluster.google_drive_folder,
        mime_type:         file.mimeType,
        size_bytes:        file.sizeBytes,
        modified_time:     file.modifiedTime,
        md5:               file.md5,
      });
    }
  }

  // 3. Read the contents of new or changed files (unchanged files keep their stored text)
  await ensureSyncSchemaOnce(pool);
  const { rows: existingDocs } = await pool.query(
    'SELECT file_id, md5, modified_time, size_bytes, content_status, extractor_version FROM cluster_documents WHERE cluster_id = $1 AND file_id IS NOT NULL',
    [cluster.id]);
  const existing = new Map(existingDocs.map((d) => [d.file_id, d]));
  const readerVersion = extractorVersion();
  const unchanged = (doc) => {
    const e = existing.get(doc.file_id);
    if (!e || e.content_status == null || e.content_status === 'error') return false;
    // 'unsupported' files (protected, unknown format) are retried when the reader or the password file changes
    if (e.content_status === 'unsupported' && e.extractor_version !== readerVersion) return false;
    if (doc.md5) return e.md5 === doc.md5;
    return e.modified_time && new Date(e.modified_time).getTime() === new Date(doc.modified_time).getTime()
      && Number(e.size_bytes ?? 0) === Number(doc.size_bytes ?? 0);
  };
  const toParse = allDocuments.filter((d) => !unchanged(d));
  let cursor = 0;
  async function parseWorker() {
    while (cursor < toParse.length) {
      const doc = toParse[cursor++];
      try {
        const { buffer } = await downloadDriveFileBuffer(doc.file_id, doc.mime_type);
        doc.content = await extractTextInWorker(buffer, { name: doc.original_filename, mimeType: doc.mime_type, size: buffer.length, fileId: doc.file_id });
      } catch (err) {
        doc.content = { status: 'error', text: null, error: String(err.message ?? err).slice(0, 300) };
      }
    }
  }
  await Promise.all(Array.from({ length: 4 }, parseWorker));

  // 4. One transaction: either everything from Drive is applied, or nothing is.
  const client = await pool.connect();
  let result;
  try {
    await client.query('BEGIN');
    result = await applyApplicationCsv(client, cluster, csv.fields);
    for (const doc of allDocuments) {
      const c = doc.content;
      await client.query(
        `INSERT INTO cluster_documents
           (cluster_id, file_id, section, document_type, original_filename, file_extension, google_drive_url, folder_url,
            mime_type, size_bytes, modified_time, md5, content_text, content_status, content_error, content_chars, content_parsed_at, extractor_version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, CASE WHEN $17::boolean THEN NOW() END, CASE WHEN $17::boolean THEN $18 END)
         ON CONFLICT (cluster_id, file_id) DO UPDATE SET
           section = EXCLUDED.section, document_type = EXCLUDED.document_type, original_filename = EXCLUDED.original_filename,
           file_extension = EXCLUDED.file_extension, google_drive_url = EXCLUDED.google_drive_url, folder_url = EXCLUDED.folder_url,
           mime_type = EXCLUDED.mime_type, size_bytes = EXCLUDED.size_bytes, modified_time = EXCLUDED.modified_time, md5 = EXCLUDED.md5,
           content_text      = CASE WHEN $17::boolean THEN EXCLUDED.content_text      ELSE cluster_documents.content_text END,
           content_status    = CASE WHEN $17::boolean THEN EXCLUDED.content_status    ELSE cluster_documents.content_status END,
           content_error     = CASE WHEN $17::boolean THEN EXCLUDED.content_error     ELSE cluster_documents.content_error END,
           content_chars     = CASE WHEN $17::boolean THEN EXCLUDED.content_chars     ELSE cluster_documents.content_chars END,
           content_parsed_at = CASE WHEN $17::boolean THEN NOW() ELSE cluster_documents.content_parsed_at END,
           extractor_version = CASE WHEN $17::boolean THEN EXCLUDED.extractor_version ELSE cluster_documents.extractor_version END`,
        [cluster.id, doc.file_id, doc.section, doc.document_type, doc.original_filename, doc.file_extension, doc.google_drive_url,
          doc.folder_url, doc.mime_type, doc.size_bytes, doc.modified_time, doc.md5,
          c ? c.text : null, c ? c.status : null, c ? c.error : null, c && c.text ? Array.from(c.text).length : null, !!c, readerVersion],   // code points, like PostgreSQL length()
      );
    }
    // Files removed from Drive (and legacy rows without a file id) are removed here too
    await client.query(
      'DELETE FROM cluster_documents WHERE cluster_id = $1 AND (file_id IS NULL OR file_id <> ALL($2::text[]))',
      [cluster.id, allDocuments.map((d) => d.file_id)],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // 5. Drop caches so the dashboard and assistant see the new values immediately
  await Promise.all([
    cacheInvalidate('portfolio:*'),
    cacheInvalidate('clusters:list:*'),
    cacheInvalidate(`cluster:detail:${applicationNumber}`),
  ]);

  lastSyncTime = new Date().toISOString();
  return {
    ok: true,
    synced: true,
    applicationNumber,
    changedFields: result.changes,
    filesScanned: allDocuments.length,
    filesRead: toParse.length,
    filesUnchanged: allDocuments.length - toParse.length,
    sectionsCount: sections.length,
    csvModified: csv.file.modifiedTime,
    syncedAt: lastSyncTime,
  };
}

/** Syncs every cluster (startup reconcile and manual full refresh). */
export async function syncAllClusters({ concurrency = 3 } = {}) {
  const { rows } = await pool.query('SELECT application_number FROM clusters ORDER BY application_number');
  const summary = { total: rows.length, synced: 0, failed: [], changedFields: 0 };
  let idx = 0;
  async function worker() {
    while (idx < rows.length) {
      const { application_number: app } = rows[idx++];
      try {
        const r = await syncClusterFromDrive(app);
        if (r.ok) { summary.synced++; summary.changedFields += r.changedFields; }
        else summary.failed.push(`${app}: ${r.message}`);
      } catch (err) {
        summary.failed.push(`${app}: ${err.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return summary;
}

// ── Folder -> cluster map (so a change deep inside any section is attributed correctly) ──
async function buildFolderMap() {
  const { rows } = await pool.query(
    'SELECT application_number, google_drive_folder FROM clusters WHERE google_drive_folder IS NOT NULL');
  let idx = 0;
  async function worker() {
    while (idx < rows.length) {
      const r = rows[idx++];
      const id = extractFolderId(r.google_drive_folder);
      if (!id) continue;
      try { await listSubfolderContents(id, true, r.application_number); }
      catch (err) { console.warn(`[Drive] Folder map failed for ${r.application_number}:`, err.message); }
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  console.log(`[Drive] Folder map ready: ${folderToClusterMap.size} folders across ${rows.length} clusters`);
}

/** Walks up the folder tree until it reaches a folder that belongs to a known cluster. */
async function resolveCluster(folderId, depth = 0) {
  if (folderToClusterMap.has(folderId)) return folderToClusterMap.get(folderId);
  if (depth > 6 || !driveClient) return null;
  try {
    const { data } = await driveClient.files.get({ fileId: folderId, fields: 'id, parents', supportsAllDrives: true });
    for (const parent of data.parents ?? []) {
      const app = await resolveCluster(parent, depth + 1);
      if (app) { folderToClusterMap.set(folderId, app); return app; }
    }
  } catch { /* not accessible or not a cluster folder */ }
  return null;
}

// ── Background poller: every 30 seconds ───────────────────────
let polling = false;

async function pollChanges() {
  if (!driveEnabled || !changesStartPageToken || polling) return;
  polling = true;
  try {
    let token = changesStartPageToken;
    while (token) {
      const { data } = await driveClient.changes.list({
        pageToken: token,
        pageSize: 100,
        fields: 'nextPageToken, newStartPageToken, changes(fileId, removed, file(name, parents, mimeType, trashed))',
        spaces: 'drive',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });

      const changedFolderIds = new Set();
      const affected = new Set();
      for (const change of data.changes ?? []) {
        if (change.fileId) await cacheInvalidate(`drive:filecontent:${change.fileId}`);
        let attributed = false;
        for (const parent of change.file?.parents ?? []) {
          changedFolderIds.add(parent);
          const app = await resolveCluster(parent);
          if (app) { affected.add(app); attributed = true; }
        }
        if (change.file?.mimeType === 'application/vnd.google-apps.folder') {
          changedFolderIds.add(change.fileId);
          const app = await resolveCluster(change.fileId);
          if (app) { affected.add(app); attributed = true; }
        }
        // Permanently removed files carry no parents: find the cluster through its stored document links
        if (!attributed && change.removed && change.fileId) {
          const { rows } = await pool.query(
            `SELECT DISTINCT c.application_number FROM cluster_documents d
               JOIN clusters c ON c.id = d.cluster_id WHERE d.google_drive_url LIKE $1`,
            [`%${change.fileId}%`],
          );
          rows.forEach((r) => affected.add(r.application_number));
        }
      }

      for (const folderId of changedFolderIds) await cacheInvalidate(`drive:folder:${folderId}`);

      for (const app of affected) {
        try {
          const r = await syncClusterFromDrive(app);
          console.log(r.ok
            ? `[Drive] Synced ${app} from Drive (${r.changedFields} fields changed)`
            : `[Drive] Could not sync ${app}: ${r.message}`);
        } catch (err) {
          console.warn(`[Drive] Failed auto-sync for ${app}:`, err.message);
        }
      }
      if (affected.size > 0) {
        await cacheSet('drive:changed_folders', [...changedFolderIds], 60);
        await broadcast([...changedFolderIds], [...affected]);
      }

      if (data.nextPageToken) {
        token = data.nextPageToken;
        changesStartPageToken = data.nextPageToken;
      } else {
        if (data.newStartPageToken) changesStartPageToken = data.newStartPageToken;
        token = null;
      }
    }
    lastSyncTime = new Date().toISOString();
  } catch (err) {
    console.error('[Drive] pollChanges error:', err.message);
  } finally {
    polling = false;
  }
}

export function startChangesPoller() {
  if (!driveEnabled) return;
  if (pollerTimer) clearInterval(pollerTimer);
  pollerTimer = setInterval(pollChanges, POLL_INTERVAL_MS);
  console.log(`[Drive] Changes poller started — checking every ${POLL_INTERVAL_MS / 1000}s`);

  // Map every folder to its cluster, then reconcile the database with Drive once
  // (this also catches anything that changed while the server was off).
  buildFolderMap()
    .then(async () => {
      if (process.env.DRIVE_SYNC_ON_START === 'false') return;
      const s = await syncAllClusters();
      console.log(`[Drive] Startup sync: ${s.synced}/${s.total} clusters, ${s.changedFields} fields updated, ${s.failed.length} failed`);
      s.failed.slice(0, 10).forEach((m) => console.warn('[Drive] Startup sync failure:', m));
    })
    .catch((err) => console.error('[Drive] Startup sync error:', err.message));

  // New subfolders can appear at any time: refresh the map periodically
  const refresh = setInterval(() => buildFolderMap().catch(() => {}), 15 * 60 * 1000);
  refresh.unref?.();
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

// ── Test hooks (used by tests/drive-db.test.js) ───────────────
export const __test = {
  buildFolderMap,
  resolveCluster,
  pollChangesNow: pollChanges,
  folderMapSize: () => folderToClusterMap.size,
  getChangesToken: () => changesStartPageToken,
  setChangesToken: (t) => { changesStartPageToken = t; },
  getDriveClient: () => driveClient,
};
