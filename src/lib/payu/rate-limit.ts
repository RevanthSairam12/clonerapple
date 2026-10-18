/**
 * In-Memory Sliding Window Rate Limiter
 * 
 * Protects payment endpoints against abuse, card testing, and denial of service.
 * Automatic memory cleanup prevents memory leaks in long-running processes.
 */

interface RateLimitEntry {
  timestamps: number[];
}

const store = new Map<string, RateLimitEntry>();
const CLEANUP_INTERVAL_MS = 60 * 1000;
let lastCleanup = Date.now();

function purgeExpired(windowMs: number) {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;

  const threshold = now - windowMs;
  for (const [key, entry] of store.entries()) {
    entry.timestamps = entry.timestamps.filter((t) => t > threshold);
    if (entry.timestamps.length === 0) {
      store.delete(key);
    }
  }
}

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

/**
 * Checks and records an access attempt for the specified key.
 */
export function checkRateLimit(key: string, options: RateLimitOptions): RateLimitResult {
  purgeExpired(options.windowMs);

  const now = Date.now();
  const threshold = now - options.windowMs;

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  // Filter timestamps outside current window
  entry.timestamps = entry.timestamps.filter((t) => t > threshold);

  if (entry.timestamps.length >= options.limit) {
    const oldestInWindow = entry.timestamps[0];
    const retryAfterMs = Math.max(0, oldestInWindow + options.windowMs - now);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.ceil(retryAfterMs / 1000),
    };
  }

  entry.timestamps.push(now);
  return {
    allowed: true,
    remaining: options.limit - entry.timestamps.length,
    retryAfterSec: 0,
  };
}
