import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 100, 2000),
  lazyConnect: true,           // don't fail on startup if Redis is down
  enableOfflineQueue: false,   // drop requests rather than queue indefinitely
});

redis.on('connect', () => console.log('[Redis] Connected'));
redis.on('error',   (err) => console.warn('[Redis] Error:', err.message));
redis.on('close',   () => console.warn('[Redis] Connection closed'));

/**
 * Check Redis connectivity — resolves true or false (never throws).
 */
export async function checkRedisConnection() {
  try {
    await redis.connect();
    const pong = await redis.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}

// ── Cache helpers ─────────────────────────────────────────────

/**
 * Get a cached value. Returns null on miss or Redis unavailable.
 */
export async function cacheGet(key) {
  try {
    const raw = await redis.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;   // Redis down → cache miss, fall through to DB
  }
}

/**
 * Set a cached value with TTL in seconds.
 */
export async function cacheSet(key, value, ttlSeconds = 300) {
  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch {
    // Redis down → silently skip caching
  }
}

/**
 * Invalidate all keys matching a pattern.
 */
export async function cacheInvalidate(pattern) {
  try {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) await redis.del(...keys);
  } catch {
    // ignore
  }
}

export default redis;
