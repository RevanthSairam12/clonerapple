import { createHash } from 'node:crypto';
import type postgres from 'postgres';

import { checkRateLimit } from '@/lib/payu/rate-limit';

/**
 * PostgreSQL-backed distributed sliding-window rate limiter & security event counter.
 *
 * Uses the existing `auth_rate_limits` table (migration 0068, RLS enabled with no
 * public policies). Every bucket key is SHA-256 hashed before leaving Node so raw
 * IP addresses and email addresses are never stored.
 *
 * Concurrency: executes advisory lock acquisition and counting/inserting as
 * distinct statements inside a single transaction so PostgreSQL READ COMMITTED
 * takes a fresh snapshot after acquiring the lock, preventing concurrent bursts
 * across serverless instances from overshooting the cap.
 */

const RATE_LIMIT_ADVISORY_NAMESPACE = 614202;
const DEFAULT_RETENTION_MS = 2 * 60 * 60 * 1000; // 2 hours
const OPPORTUNISTIC_PRUNE_INTERVAL_MS = 5 * 60 * 1000;
const OPPORTUNISTIC_PRUNE_BATCH = 500;
const MEMORY_FAILURE_WARNING_COOLDOWN_MS = 60 * 1000;

let lastPruneAt = 0;
let lastFallbackWarnAt = 0;

export interface DistributedRateLimitBucket {
  scope: string;
  key: string;
  limit: number;
  windowMs: number;
}

export interface DistributedRateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
  backend: 'postgres' | 'memory';
  blockedScope?: string;
}

export interface DistributedRateLimitOptions {
  sql?: postgres.Sql | null;
  now?: Date;
  fallbackToMemory?: boolean;
}

function hashBucketKey(scope: string, rawKey: string): string {
  return createHash('sha256').update(`${scope}:${rawKey}`).digest('hex');
}

async function resolveSql(sqlOverride?: postgres.Sql | null): Promise<postgres.Sql | null> {
  if (sqlOverride !== undefined) return sqlOverride;
  try {
    const { getSql } = await import('@/lib/platform/db');
    return getSql();
  } catch {
    return null;
  }
}

function warnFallback(context: string): void {
  const now = Date.now();
  if (now - lastFallbackWarnAt < MEMORY_FAILURE_WARNING_COOLDOWN_MS) return;
  lastFallbackWarnAt = now;
  console.warn(`[rate-limit] distributed store unavailable during ${context}; using bounded local fallback`);
}

function checkMemoryFallback(
  buckets: ReadonlyArray<NormalizedDistributedRateLimitBucket>,
  nowMs: number,
): DistributedRateLimitResult {
  let minRemaining = Number.POSITIVE_INFINITY;
  for (const bucket of buckets) {
    const result = checkRateLimit(`dist:${bucket.scope}:${bucket.hash}`, {
      limit: bucket.limit,
      windowMs: bucket.windowMs,
      now: nowMs,
    });
    if (!result.allowed) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSec: Math.max(1, result.retryAfterSec),
        backend: 'memory',
        blockedScope: bucket.scope,
      };
    }
    minRemaining = Math.min(minRemaining, result.remaining);
  }
  return {
    allowed: true,
    remaining: Number.isFinite(minRemaining) ? minRemaining : 0,
    retryAfterSec: 0,
    backend: 'memory',
  };
}

/**
 * Prune expired `auth_rate_limits` rows in bounded batches so the index stays small
 * even if cron reconciliation pauses.
 */
export async function pruneExpiredRateLimitsUsing(
  sql: postgres.Sql,
  options: { retentionMs?: number; batchSize?: number; now?: Date } = {},
): Promise<number> {
  const retentionMs = Math.max(60_000, Math.trunc(options.retentionMs ?? DEFAULT_RETENTION_MS));
  const batchSize = Math.min(Math.max(1, Math.trunc(options.batchSize ?? OPPORTUNISTIC_PRUNE_BATCH)), 5_000);
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - retentionMs);

  const deleted = (await sql`
    delete from auth_rate_limits
    where id in (
      select id
      from auth_rate_limits
      where created_at < ${cutoff}
      order by id asc
      limit ${batchSize}
    )
    returning id
  `) as Array<{ id: number }>;

  return deleted.length;
}

async function maybeOpportunisticPrune(sql: postgres.Sql, now: Date): Promise<void> {
  const nowMs = now.getTime();
  if (nowMs - lastPruneAt < OPPORTUNISTIC_PRUNE_INTERVAL_MS) return;
  lastPruneAt = nowMs;
  try {
    await pruneExpiredRateLimitsUsing(sql, { now });
  } catch {
    // Best-effort housekeeping must never disrupt requests.
  }
}

interface NormalizedDistributedRateLimitBucket {
  scope: string;
  hash: string;
  lockKey: string;
  limit: number;
  windowMs: number;
}

function normalizeBuckets(
  buckets: ReadonlyArray<DistributedRateLimitBucket>,
): NormalizedDistributedRateLimitBucket[] {
  const seen = new Set<string>();
  const normalized: NormalizedDistributedRateLimitBucket[] = [];

  for (const bucket of buckets) {
    const key = typeof bucket.key === 'string' ? bucket.key.trim() : '';
    if (!bucket.scope || !key) continue;
    const limit = Math.max(1, Math.trunc(bucket.limit));
    const windowMs = Math.max(1_000, Math.trunc(bucket.windowMs));
    const hash = hashBucketKey(bucket.scope, key);
    const lockKey = `${bucket.scope}:${hash}`;
    if (seen.has(lockKey)) continue;
    seen.add(lockKey);
    normalized.push({ scope: bucket.scope, hash, lockKey, limit, windowMs });
  }

  return normalized;
}

/**
 * Atomically check and record attempts across one or more rate-limit buckets.
 * All buckets are locked in deterministic sorted order; if any bucket is over
 * its cap, no bucket records the rejected hit.
 */
export async function checkDistributedRateLimits(
  buckets: ReadonlyArray<DistributedRateLimitBucket>,
  options: DistributedRateLimitOptions = {},
): Promise<DistributedRateLimitResult> {
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const normalized = normalizeBuckets(buckets);

  if (normalized.length === 0) {
    return { allowed: true, remaining: 0, retryAfterSec: 0, backend: 'postgres' };
  }

  const sql = await resolveSql(options.sql);
  if (!sql) {
    return checkMemoryFallback(normalized, nowMs);
  }

  const sortedLocks = [...normalized].sort((a, b) => a.lockKey.localeCompare(b.lockKey));

  try {
    const result = await sql.begin(async (tx) => {
      // Statement 1: bound timeouts and acquire all advisory locks in sorted order
      // BEFORE reading `auth_rate_limits` so READ COMMITTED sees prior commits.
      await tx`
        select
          set_config('lock_timeout', '3000ms', true),
          set_config('statement_timeout', '3000ms', true),
          pg_advisory_xact_lock(${RATE_LIMIT_ADVISORY_NAMESPACE}, hashtext(lock_key))
        from unnest(${sortedLocks.map((b) => b.lockKey)}::text[]) as lock_key
      `;

      let minRemaining = Number.POSITIVE_INFINITY;
      let worstRetryAfterSec = 0;
      let blockedScope: string | undefined;

      for (const bucket of sortedLocks) {
        const cutoff = new Date(nowMs - bucket.windowMs);
        const rows = (await tx`
          select count(*)::int as hits, min(created_at) as oldest
          from auth_rate_limits
          where scope = ${bucket.scope}
            and bucket_key = ${bucket.hash}
            and created_at > ${cutoff}
        `) as Array<{ hits: number | string; oldest: Date | string | null }>;

        const hits = Number(rows[0]?.hits ?? 0);
        if (hits >= bucket.limit) {
          const oldestRaw = rows[0]?.oldest;
          const oldestMs = oldestRaw instanceof Date
            ? oldestRaw.getTime()
            : oldestRaw
              ? Date.parse(String(oldestRaw))
              : nowMs;
          const retryMs = Number.isFinite(oldestMs)
            ? Math.max(1_000, oldestMs + bucket.windowMs - nowMs)
            : bucket.windowMs;
          const retrySec = Math.max(1, Math.ceil(retryMs / 1000));
          if (retrySec >= worstRetryAfterSec) {
            worstRetryAfterSec = retrySec;
            blockedScope = bucket.scope;
          }
        } else {
          minRemaining = Math.min(minRemaining, Math.max(0, bucket.limit - (hits + 1)));
        }
      }

      if (blockedScope) {
        return {
          allowed: false,
          remaining: 0,
          retryAfterSec: Math.max(1, worstRetryAfterSec),
          backend: 'postgres' as const,
          blockedScope,
        };
      }

      await tx`
        insert into auth_rate_limits (scope, bucket_key, created_at)
        select s, k, ${now}
        from unnest(
          ${sortedLocks.map((b) => b.scope)}::text[],
          ${sortedLocks.map((b) => b.hash)}::text[]
        ) as entry(s, k)
      `;

      return {
        allowed: true,
        remaining: Number.isFinite(minRemaining) ? minRemaining : 0,
        retryAfterSec: 0,
        backend: 'postgres' as const,
      };
    });

    if (options.sql === undefined) {
      void maybeOpportunisticPrune(sql, now);
    }
    return result;
  } catch {
    if (options.fallbackToMemory === false) {
      throw new Error('Distributed rate limiter unavailable.');
    }
    warnFallback('check');
    return checkMemoryFallback(normalized, nowMs);
  }
}

export async function checkDistributedRateLimit(
  bucket: DistributedRateLimitBucket,
  options: DistributedRateLimitOptions = {},
): Promise<DistributedRateLimitResult> {
  return checkDistributedRateLimits([bucket], options);
}

/** Count security events (such as recent failed logins) without inserting one. */
export async function countDistributedEvents(
  buckets: ReadonlyArray<DistributedRateLimitBucket>,
  options: DistributedRateLimitOptions = {},
): Promise<{
  blocked: boolean;
  retryAfterSec: number;
  backend: 'postgres' | 'memory';
}> {
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const normalized = normalizeBuckets(buckets);
  if (normalized.length === 0) {
    return { blocked: false, retryAfterSec: 0, backend: 'postgres' };
  }

  const sql = await resolveSql(options.sql);
  if (!sql) {
    return { blocked: false, retryAfterSec: 0, backend: 'memory' };
  }

  try {
    let blocked = false;
    let worstRetryAfterSec = 0;

    for (const bucket of normalized) {
      const cutoff = new Date(nowMs - bucket.windowMs);
      const rows = (await sql`
        select count(*)::int as hits, min(created_at) as oldest
        from auth_rate_limits
        where scope = ${bucket.scope}
          and bucket_key = ${bucket.hash}
          and created_at > ${cutoff}
      `) as Array<{ hits: number | string; oldest: Date | string | null }>;

      const hits = Number(rows[0]?.hits ?? 0);
      if (hits >= bucket.limit) {
        blocked = true;
        const oldestRaw = rows[0]?.oldest;
        const oldestMs = oldestRaw instanceof Date
          ? oldestRaw.getTime()
          : oldestRaw
            ? Date.parse(String(oldestRaw))
            : nowMs;
        const retryMs = Number.isFinite(oldestMs)
          ? Math.max(1_000, oldestMs + bucket.windowMs - nowMs)
          : bucket.windowMs;
        worstRetryAfterSec = Math.max(worstRetryAfterSec, Math.ceil(retryMs / 1000));
      }
    }

    return {
      blocked,
      retryAfterSec: blocked ? Math.max(1, worstRetryAfterSec) : 0,
      backend: 'postgres',
    };
  } catch {
    warnFallback('count');
    return { blocked: false, retryAfterSec: 0, backend: 'memory' };
  }
}

/** Record failure/security event rows across one or more buckets atomically. */
export async function recordDistributedEvents(
  entries: ReadonlyArray<{ scope: string; key: string }>,
  options: { sql?: postgres.Sql | null; now?: Date } = {},
): Promise<boolean> {
  const now = options.now ?? new Date();
  const valid = entries
    .map((entry) => ({ scope: entry.scope, key: entry.key.trim() }))
    .filter((entry) => entry.scope && entry.key);
  if (valid.length === 0) return true;

  const sql = await resolveSql(options.sql);
  if (!sql) return false;

  try {
    const scopes = valid.map((entry) => entry.scope);
    const hashes = valid.map((entry) => hashBucketKey(entry.scope, entry.key));
    await sql`
      insert into auth_rate_limits (scope, bucket_key, created_at)
      select s, k, ${now}
      from unnest(${scopes}::text[], ${hashes}::text[]) as entry(s, k)
    `;
    return true;
  } catch {
    warnFallback('record');
    return false;
  }
}

/** Clear recorded security events for the specified scope+key pairs (e.g. email failures after success). */
export async function clearDistributedEvents(
  entries: ReadonlyArray<{ scope: string; key: string }>,
  options: { sql?: postgres.Sql | null } = {},
): Promise<boolean> {
  const valid = entries
    .map((entry) => ({ scope: entry.scope, key: entry.key.trim() }))
    .filter((entry) => entry.scope && entry.key);
  if (valid.length === 0) return true;

  const sql = await resolveSql(options.sql);
  if (!sql) return false;

  try {
    for (const entry of valid) {
      const hash = hashBucketKey(entry.scope, entry.key);
      await sql`
        delete from auth_rate_limits
        where scope = ${entry.scope}
          and bucket_key = ${hash}
      `;
    }
    return true;
  } catch {
    warnFallback('clear');
    return false;
  }
}

export function resetRateLimitHousekeepingForTests(): void {
  lastPruneAt = 0;
  lastFallbackWarnAt = 0;
}
