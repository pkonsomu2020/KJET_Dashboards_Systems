import { Router } from 'express';
import { createReadStream } from 'fs';
import { extname } from 'path';
import { COHORTS, getFinalistList, getFinalistDetail, getFinalistDocumentPath, getFinalistSheetStatus, syncFinalistSheet } from '../services/finalists.js';

const router = Router();
const MIME = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

// All routes: auth is enforced where the router is mounted.
const WHOLE = /^\d{1,9}$/;
// a finalist's key: the sheet's Application ID without "Applicant" ("297", "KJET-20251229171110-PYGB")
const KEY = /^[A-Za-z0-9._-]{1,80}$/;
const bad = (res, what) => { res.status(400).json({ ok: false, error: `Invalid ${what}` }); return false; };
const cohortOf = (req, res) => {
  const c = Number(req.params.cohort);
  if (!COHORTS[c]) { res.status(404).json({ ok: false, error: 'No finalists for this cohort' }); return null; }
  return c;
};

// GET /api/finalists/:cohort  every finalist of the cohort, as in the cohort's sheet, with form figures and document counts
router.get('/:cohort', async (req, res, next) => {
  try { const c = cohortOf(req, res); if (c) res.json({ ok: true, ...(await getFinalistList(c)) }); } catch (err) { next(err); }
});

// GET /api/finalists/:cohort/status  state of the link to the cohort's online sheet
router.get('/:cohort/status', (req, res) => { const c = cohortOf(req, res); if (c) res.json({ ok: true, ...getFinalistSheetStatus(c) }); });

// POST /api/finalists/:cohort/refresh  pull the cohort's online sheet now
router.post('/:cohort/refresh', async (req, res, next) => {
  try { const c = cohortOf(req, res); if (!c) return; await syncFinalistSheet(c, { force: true }); res.json({ ok: true, ...getFinalistSheetStatus(c) }); } catch (err) { next(err); }
});

// GET /api/finalists/:cohort/:applicantId  one finalist: scores, the application form (without its finance questions) and the document list
router.get('/:cohort/:applicantId', async (req, res, next) => {
  try {
    const c = cohortOf(req, res); if (!c) return;
    if (!KEY.test(req.params.applicantId)) return bad(res, 'applicant id');
    const detail = await getFinalistDetail(c, req.params.applicantId);
    if (!detail) return res.status(404).json({ ok: false, error: 'No such finalist' });
    res.json({ ok: true, data: detail });
  } catch (err) { next(err); }
});

// GET /api/finalists/:cohort/:applicantId/documents/:index  one document of the finalist, opened in the browser
router.get('/:cohort/:applicantId/documents/:index', async (req, res, next) => {
  try {
    const c = cohortOf(req, res); if (!c) return;
    if (!KEY.test(req.params.applicantId)) return bad(res, 'applicant id');
    if (!WHOLE.test(req.params.index)) return bad(res, 'document number');
    const doc = await getFinalistDocumentPath(c, req.params.applicantId, Number(req.params.index));
    if (!doc) return res.status(404).json({ ok: false, error: 'Document not found' });
    res.setHeader('Content-Type', MIME[extname(doc.name).toLowerCase()] ?? 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(doc.name)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    createReadStream(doc.full).on('error', next).pipe(res);
  } catch (err) { next(err); }
});

export default router;
