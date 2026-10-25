import { Router } from 'express';
import archiver from 'archiver';
import { getEvaluationList, getEvaluationOverview, getEvaluationDetail } from '../services/evaluationService.js';
import { buildEvaluationReport } from '../services/evaluationReport.js';
import { getEvaluationSheetStatus, syncEvaluationSheet } from '../services/evaluationSheet.js';

const router = Router();
const APP_RE = /^KJET-\d{4}-\d{6}$/;

// All routes: auth is enforced where the router is mounted.

// GET /api/evaluation/overview  portfolio picture: funnel, bands, score spread, counties, value chains, common issues
router.get('/overview', async (_req, res, next) => {
  try { res.json({ ok: true, ...(await getEvaluationOverview(typeof _req.query.county === 'string' ? _req.query.county : '')) }); } catch (err) { next(err); }
});

// GET /api/evaluation/clusters  every evaluated cluster (scores, E1-E10 outcomes, screening from Drive)
router.get('/clusters', async (_req, res, next) => {
  try { res.json({ ok: true, ...(await getEvaluationList()) }); } catch (err) { next(err); }
});

// GET /api/evaluation/status  state of the link to the online evaluation sheet
router.get('/status', (_req, res) => res.json({ ok: true, ...getEvaluationSheetStatus() }));

// POST /api/evaluation/refresh  pull the online sheet now
router.post('/refresh', async (_req, res, next) => {
  try {
    await syncEvaluationSheet({ force: true });
    res.json({ ok: true, ...getEvaluationSheetStatus() });
  } catch (err) { next(err); }
});

// GET /api/evaluation/reports.zip  one PDF report per evaluated cluster, in one zip
router.get('/reports.zip', async (req, res, next) => {
  try {
    const { data } = await getEvaluationList();
    const rows = data;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="KJET-evaluation-reports.zip"`);
    const zip = archiver('zip', { zlib: { level: 6 } });
    zip.on('error', next);
    zip.pipe(res);
    for (const r of rows) {
      const report = await buildEvaluationReport(r.application_number);
      if (report) zip.append(report.buffer, { name: report.filename });
    }
    await zip.finalize();
  } catch (err) { next(err); }
});

// GET /api/evaluation/clusters/:applicationNumber  full evaluation of one cluster
router.get('/clusters/:applicationNumber', async (req, res, next) => {
  try {
    if (!APP_RE.test(req.params.applicationNumber)) return res.status(400).json({ ok: false, error: 'Invalid application number' });
    const detail = await getEvaluationDetail(req.params.applicationNumber);
    if (!detail) return res.status(404).json({ ok: false, error: 'No evaluation for this cluster' });
    res.json({ ok: true, data: detail });
  } catch (err) { next(err); }
});

// GET /api/evaluation/clusters/:applicationNumber/report.pdf  the cluster's evaluation report
router.get('/clusters/:applicationNumber/report.pdf', async (req, res, next) => {
  try {
    if (!APP_RE.test(req.params.applicationNumber)) return res.status(400).json({ ok: false, error: 'Invalid application number' });
    const report = await buildEvaluationReport(req.params.applicationNumber);
    if (!report) return res.status(404).json({ ok: false, error: 'No evaluation for this cluster' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${report.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(report.buffer);
  } catch (err) { next(err); }
});

export default router;
