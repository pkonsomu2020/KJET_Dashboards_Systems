import { Router } from 'express';
import {
  getPortfolioSummary,
  getByValueChain,
  getByCounty,
} from '../services/clusterService.js';

const router = Router();

// GET /api/portfolio/summary
router.get('/summary', async (_req, res, next) => {
  try {
    const data = await getPortfolioSummary();
    res.json({ ok: true, data });
  } catch (err) { next(err); }
});

// GET /api/portfolio/by-chain
router.get('/by-chain', async (_req, res, next) => {
  try {
    const result = await getByValueChain();
    res.json({ ok: true, ...result });
  } catch (err) { next(err); }
});

// GET /api/portfolio/by-county
router.get('/by-county', async (_req, res, next) => {
  try {
    const result = await getByCounty();
    res.json({ ok: true, ...result });
  } catch (err) { next(err); }
});

// GET /api/portfolio/compliance
router.get('/compliance', async (_req, res, next) => {
  try {
    const pool = (await import('../db/pool.js')).default;
    const { rows } = await pool.query(`
      SELECT compliance_status, COUNT(*) AS count
      FROM cluster_financials
      GROUP BY compliance_status
    `);
    res.json({ ok: true, data: rows });
  } catch (err) { next(err); }
});

export default router;
