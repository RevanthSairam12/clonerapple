/**
 * Process-local sliding-window rate limiter & shared-store interface.
 *
 * Security-sensitive and multi-instance routes use
 * `src/lib/platform/distributed-rate-limit.ts` (PostgreSQL `auth_rate_limits`),
 * which delegates to this bounded store only as an outage/offline fallback.
 */

/** The shape a shared limiter implements; distributed callers use `distributed-rate-limit.ts`. */
export interface RateLimitStore {
  increment(key: string, windowMs: number): Promise<RateLimitResult>;
  reset(key: string): Promise<void>;
}

interface RateLimitEntry {
  timestamps: number[];
  windowMs: number;
  lastAccessAt: number;
}

const store = new Map<string, RateLimitEntry>();
const CLEANUP_INTERVAL_MS = 60 * 1000;
export const MAX_RATE_LIMIT_STORE_ENTRIES = 10_000;
let lastCleanup = Date.now();

function purgeExpired(now: number): void {
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;

  for (const [key, entry] of store.entries()) {
    const threshold = now - entry.windowMs;
    entry.timestamps = entry.timestamps.filter((t) => t > threshold);
    if (entry.timestamps.length === 0) {
      store.delete(key);
    }
  }
}

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  now?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

/**
 * Checks and records an access attempt for the specified key in process memory.
 */
export function checkRateLimit(key: string, options: RateLimitOptions): RateLimitResult {
  const now = typeof options.now === 'number' && Number.isFinite(options.now) ? options.now : Date.now();
  const windowMs = Math.max(1_000, Math.trunc(options.windowMs));
  const limit = Math.max(1, Math.trunc(options.limit));

  purgeExpired(now);

  const threshold = now - windowMs;
  let entry = store.get(key);
  if (!entry) {
    if (store.size >= MAX_RATE_LIMIT_STORE_ENTRIES) {
      // Prefer evicting any already-expired entry before falling back to LRU.
      let evicted = false;
      for (const [k, existing] of store.entries()) {
        if (existing.timestamps.every((t) => t <= now - existing.windowMs)) {
          store.delete(k);
          evicted = true;
          break;
        }
      }
      if (!evicted) {
        const oldestKey = store.keys().next().value;
        if (oldestKey !== undefined) store.delete(oldestKey);
      }
    }
    entry = { timestamps: [], windowMs, lastAccessAt: now };
  } else {
    // Refresh insertion order for bounded LRU eviction and preserve the largest window seen for this key.
    store.delete(key);
    entry.windowMs = Math.max(entry.windowMs, windowMs);
    entry.lastAccessAt = now;
  }
  store.set(key, entry);

  // Filter timestamps outside the current request's window without clobbering longer-window entries elsewhere.
  entry.timestamps = entry.timestamps.filter((t) => t > threshold);

  if (entry.timestamps.length >= limit) {
    const oldestInWindow = entry.timestamps[0];
    const retryAfterMs = Math.max(0, oldestInWindow + windowMs - now);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }

  entry.timestamps.push(now);
  return {
    allowed: true,
    remaining: Math.max(0, limit - entry.timestamps.length),
    retryAfterSec: 0,
  };
}

/** Test-only helper to clear the in-memory store. */
export function clearRateLimitStoreForTests(): void {
  store.clear();
  lastCleanup = Date.now();
}
