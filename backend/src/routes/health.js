import { Router } from 'express';
import { checkDbConnection } from '../db/pool.js';
import { checkRedisConnection } from '../cache/redis.js';

const router = Router();

// GET /health  — used by smoke tests, load balancers, uptime monitors
router.get('/', async (_req, res) => {
  const [db, cache] = await Promise.allSettled([
    checkDbConnection(),
    checkRedisConnection(),
  ]);

  const dbOk    = db.status    === 'fulfilled' && db.value    === true;
  const cacheOk = cache.status === 'fulfilled' && cache.value === true;

  const status = dbOk ? 200 : 503;

  res.status(status).json({
    ok:        status === 200,
    timestamp: new Date().toISOString(),
    services: {
      database: dbOk    ? 'up' : 'down',
      redis:    cacheOk ? 'up' : 'down',   // Redis failure is non-fatal
    },
    version: process.env.npm_package_version || '1.0.0',
    uptime:  Math.floor(process.uptime()),
  });
});

export default router;
