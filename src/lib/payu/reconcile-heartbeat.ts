import type postgres from 'postgres';

import { getSql } from '@/lib/platform/db';

export const RECONCILE_JOB_NAME = 'payu_reconcile';
export const RECONCILE_STALE_MINUTES = 5;

const KEY_LAST_RUN_AT = 'reconcile_heartbeat_last_run_at';
const KEY_LAST_SUCCESS_AT = 'reconcile_heartbeat_last_success_at';
const KEY_LAST_PROCESSED = 'reconcile_heartbeat_last_processed_count';
const KEY_LAST_ERROR = 'reconcile_heartbeat_last_error';

export interface ReconcileHeartbeatState {
  jobName: string;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastProcessedCount: number;
  lastError: string;
  /** True when there has been no successful run in the last 5 minutes on the database clock. */
  stale: boolean;
  databaseNow: string;
}

/**
 * Pure staleness check against the database clock.
 *
 * Returns true (red / needs attention) when the job has never succeeded or the
 * last successful run is older than `maxAgeMinutes` (default 5 minutes).
 */
export function isReconcileHeartbeatStale(
  lastSuccessAt: Date | string | null | undefined,
  now: Date = new Date(),
  maxAgeMinutes: number = RECONCILE_STALE_MINUTES,
): boolean {
  if (!lastSuccessAt) return true;
  const successTime =
    lastSuccessAt instanceof Date ? lastSuccessAt.getTime() : Date.parse(String(lastSuccessAt));
  if (!Number.isFinite(successTime)) return true;
  const ageMs = now.getTime() - successTime;
  return ageMs > maxAgeMinutes * 60_000;
}

function sanitizeErrorText(error: string | null | undefined): string {
  const raw = (error ?? '').trim();
  if (!raw) return '';
  return raw.slice(0, 240);
}

/**
 * Record a reconciliation run heartbeat in `store_settings` using the database clock (`now()`).
 */
export async function recordReconcileHeartbeat(
  input: {
    processedCount: number;
    lastError?: string | null;
    succeeded: boolean;
  },
  sqlOverride?: postgres.Sql,
): Promise<void> {
  const sql = sqlOverride ?? getSql();
  if (!sql) return;

  const processed = Math.max(0, Math.trunc(Number(input.processedCount) || 0));
  const errorText = sanitizeErrorText(input.lastError);
  const succeeded = input.succeeded === true;

  try {
    const [clock] = await sql<Array<{ iso_now: string }>>`
      select to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as iso_now
    `;
    const nowIso = clock?.iso_now || new Date().toISOString();

    await sql`
      insert into store_settings (key, value, updated_at)
      values
        (${KEY_LAST_RUN_AT}, ${nowIso}, now()),
        (${KEY_LAST_ERROR}, ${errorText}, now())
      on conflict (key) do update set
        value = excluded.value,
        updated_at = now()
    `;

    if (succeeded) {
      await sql`
        insert into store_settings (key, value, updated_at)
        values
          (${KEY_LAST_SUCCESS_AT}, ${nowIso}, now()),
          (${KEY_LAST_PROCESSED}, ${String(processed)}, now())
        on conflict (key) do update set
          value = excluded.value,
          updated_at = now()
      `;
    }
  } catch {
    // Do not fail reconciliation if settings table is absent in a partial test schema.
  }
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const text = String(value).trim();
  if (!text) return null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

/**
 * Read the current reconciliation heartbeat using the database clock.
 */
export async function readReconcileHeartbeat(
  sqlOverride?: postgres.Sql,
): Promise<ReconcileHeartbeatState> {
  const fallbackNow = new Date();
  const empty: ReconcileHeartbeatState = {
    jobName: RECONCILE_JOB_NAME,
    lastRunAt: null,
    lastSuccessAt: null,
    lastProcessedCount: 0,
    lastError: '',
    stale: true,
    databaseNow: fallbackNow.toISOString(),
  };

  const sql = sqlOverride ?? getSql();
  if (!sql) return empty;

  try {
    const [clockRows, settingRows] = await Promise.all([
      sql<Array<{ db_now: Date | string }>>`select now() as db_now`,
      sql<Array<{ key: string; value: string }>>`
        select key, value
        from store_settings
        where key in (${KEY_LAST_RUN_AT}, ${KEY_LAST_SUCCESS_AT}, ${KEY_LAST_PROCESSED}, ${KEY_LAST_ERROR})
      `,
    ]);

    const dbNow = clockRows[0]?.db_now ? new Date(clockRows[0].db_now) : fallbackNow;
    const byKey = new Map(settingRows.map((row) => [String(row.key), String(row.value ?? '')]));

    const lastRunAt = toIso(byKey.get(KEY_LAST_RUN_AT));
    const lastSuccessAt = toIso(byKey.get(KEY_LAST_SUCCESS_AT));
    const lastProcessedCount = Math.max(
      0,
      Math.trunc(Number(byKey.get(KEY_LAST_PROCESSED)) || 0),
    );
    const lastError = sanitizeErrorText(byKey.get(KEY_LAST_ERROR));

    return {
      jobName: RECONCILE_JOB_NAME,
      lastRunAt,
      lastSuccessAt,
      lastProcessedCount,
      lastError,
      stale: isReconcileHeartbeatStale(lastSuccessAt, dbNow),
      databaseNow: dbNow.toISOString(),
    };
  } catch {
    return empty;
  }
}
