import { Router } from 'express';
import { z } from 'zod';
import { getClusters, getClusterByNumber } from '../services/clusterService.js';
import { cacheInvalidate } from '../cache/redis.js';
import { requireAuth } from '../middleware/index.js';
import pool from '../db/pool.js';

const router = Router();

// ── Validation schemas ────────────────────────────────────────
const listQuerySchema = z.object({
  county: z.string().optional(),
  chain:  z.string().optional(),
  sort:   z.enum(['name', 'cost', 'grant', 'members']).optional(),
  q:      z.string().max(100).optional(),
  review: z.string().optional().transform((v) => v === 'true'),
  page:   z.string().optional().transform((v) => parseInt(v) || 1),
  limit:  z.string().optional().transform((v) => Math.min(100, parseInt(v) || 20)),
});

// GET /api/clusters
router.get('/', async (req, res, next) => {
  try {
    const params = listQuerySchema.parse(req.query);
    const result = await getClusters(params);
    res.json({ ok: true, ...result });
  } catch (err) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid query parameters', details: err.errors });
    }
    next(err);
  }
});

// GET /api/clusters/meta  (dropdowns — counties and chains)
router.get('/meta', async (_req, res, next) => {
  try {
    const [counties, chains] = await Promise.all([
      pool.query('SELECT DISTINCT county FROM clusters ORDER BY county'),
      pool.query('SELECT DISTINCT value_chain FROM clusters ORDER BY value_chain'),
    ]);
    res.json({
      ok: true,
      counties: counties.rows.map((r) => r.county),
      chains:   chains.rows.map((r) => r.value_chain),
    });
  } catch (err) { next(err); }
});

// GET /api/clusters/:applicationNumber
router.get('/:applicationNumber', async (req, res, next) => {
  try {
    const { applicationNumber } = req.params;
    const result = await getClusterByNumber(applicationNumber);
    if (!result.data) return res.status(404).json({ error: 'Cluster not found' });
    res.json({ ok: true, ...result });
  } catch (err) { next(err); }
});

// PATCH /api/clusters/:applicationNumber/status
// Protected — only authenticated users
router.patch('/:applicationNumber/status', requireAuth, async (req, res, next) => {
  try {
    const allowed = ['Draft', 'Submitted', 'Under review', 'Approved', 'Rejected'];
    const { status } = req.body;
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${allowed.join(', ')}` });
    }
    const { rows } = await pool.query(
      `UPDATE clusters SET status = $1, updated_at = NOW()
       WHERE application_number = $2
       RETURNING id, application_number, status`,
      [status, req.params.applicationNumber],
    );
    if (!rows.length) return res.status(404).json({ error: 'Cluster not found' });
    await cacheInvalidate(`cluster:detail:${req.params.applicationNumber}`);
    await cacheInvalidate('clusters:list:*');
    res.json({ ok: true, data: rows[0] });
  } catch (err) { next(err); }
});

export default router;
