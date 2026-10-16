import { Router } from 'express';
import pool from '../db/pool.js';
import {
  listFolderFiles,
  listSubfolderContents,
  readDriveFileContent,
  syncClusterFromDrive,
  extractFolderId,
  isDriveEnabled,
  getLastSyncTime,
} from '../services/driveService.js';
import { cacheGet } from '../cache/redis.js';

const router = Router();

// GET /api/drive/status
// Returns whether Drive integration is active and when last synced
router.get('/status', (_req, res) => {
  res.json({
    ok:        true,
    enabled:   isDriveEnabled(),
    lastSync:  getLastSyncTime(),
    message:   isDriveEnabled()
      ? 'Drive integration active — all folder documents and subfolders are read and synced automatically'
      : 'Drive integration disabled — add service-account.json to enable',
  });
});

// GET /api/drive/changes
// Returns folder IDs that changed since last poll (for frontend to know what to refresh)
router.get('/changes', async (_req, res, next) => {
  try {
    const changed = await cacheGet('drive:changed_folders');
    res.json({ ok: true, changedFolderIds: changed ?? [] });
  } catch (err) { next(err); }
});

// GET /api/drive/folder/:applicationNumber
// Live recursive file listing for a cluster's Drive folder (fetched fresh from Drive)
router.get('/folder/:applicationNumber', async (req, res, next) => {
  try {
    const { applicationNumber } = req.params;
    const refresh = req.query.refresh === 'true';

    // Get the Google Drive folder URL from the database
    const { rows } = await pool.query(
      'SELECT cluster_name, google_drive_folder FROM clusters WHERE application_number = $1',
      [applicationNumber],
    );
    if (!rows.length) return res.status(404).json({ error: 'Cluster not found' });

    const { cluster_name, google_drive_folder } = rows[0];
    const folderId = extractFolderId(google_drive_folder);

    if (!folderId) {
      return res.json({
        ok:           true,
        clusterName:  cluster_name,
        folderUrl:    google_drive_folder,
        folderId:     null,
        sections:     [],
        driveEnabled: isDriveEnabled(),
        message:      'No valid Google Drive folder ID found',
      });
    }

    if (!isDriveEnabled()) {
      return res.json({
        ok:           true,
        clusterName:  cluster_name,
        folderUrl:    google_drive_folder,
        folderId,
        sections:     [],
        driveEnabled: false,
        message:      'Drive API not configured — open folder directly via the Drive link',
      });
    }

    // When force-refreshing, also read all documents and sync extracted metrics into PostgreSQL
    if (refresh) {
      await syncClusterFromDrive(applicationNumber).catch(err =>
        console.warn(`[Drive] Sync warning for ${applicationNumber}:`, err.message),
      );
    }

    // Fetch recursive folder contents (cached for 25s unless forceRefresh)
    const sections = await listSubfolderContents(folderId, refresh, applicationNumber);

    res.json({
      ok:           true,
      clusterName:  cluster_name,
      folderUrl:    google_drive_folder,
      folderId,
      sections,
      driveEnabled: true,
      fetchedAt:    new Date().toISOString(),
    });
  } catch (err) { next(err); }
});

// GET /api/drive/file/:fileId/content
// Reads and parses the full content (sheets, text, key-value fields) of any file in Google Drive
router.get('/file/:fileId/content', async (req, res, next) => {
  try {
    if (!isDriveEnabled()) {
      return res.status(503).json({ error: 'Drive integration not configured' });
    }
    const refresh = req.query.refresh === 'true';
    const content = await readDriveFileContent(req.params.fileId, refresh);
    res.json({ ok: true, data: content });
  } catch (err) { next(err); }
});

// POST /api/drive/sync/:applicationNumber
// Recursively reads all documents in the cluster's Drive folder and syncs extracted data to PostgreSQL
router.post('/sync/:applicationNumber', async (req, res, next) => {
  try {
    if (!isDriveEnabled()) {
      return res.status(503).json({ error: 'Drive integration not configured' });
    }
    const result = await syncClusterFromDrive(req.params.applicationNumber);
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/drive/folder-raw/:folderId
// Raw file list by folder ID (used for subfolder drill-down)
router.get('/folder-raw/:folderId', async (req, res, next) => {
  try {
    if (!isDriveEnabled()) {
      return res.status(503).json({ error: 'Drive integration not configured' });
    }
    const refresh = req.query.refresh === 'true';
    const result  = await listFolderFiles(req.params.folderId, refresh);
    res.json({ ok: true, ...result });
  } catch (err) { next(err); }
});

export default router;

