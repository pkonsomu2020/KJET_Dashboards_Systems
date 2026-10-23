import { Router } from 'express';
import { getShortlist } from '../services/evaluationService.js';

const router = Router();

// GET /api/evaluation  (auth enforced where the router is mounted)
// The grant-ready shortlist from the evaluation workbook, with summary figures.
router.get('/', async (_req, res, next) => {
  try {
    res.json({ ok: true, ...(await getShortlist()) });
  } catch (err) { next(err); }
});

export default router;
