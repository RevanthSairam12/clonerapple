import { getSql } from '@/lib/admin/db';

import { parseReportFilters, type ReportFilterParse } from './report-rules';
import { getStoreTimeZone } from './sale';

/**
 * The store's clock: the database `now()` and the store timezone setting.
 *
 * "Today", "this month" and every report day come from here, never from the
 * web server's clock or timezone, so a laptop or host in another zone cannot
 * move a sale to the wrong day.
 */

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: The store clock must be read on the server only.');
}

/** Never invent a reporting date when the database clock is unavailable. */
export async function getDatabaseNow(): Promise<Date> {
  const sql = getSql();
  if (sql) {
    try {
      const rows = (await sql`select now() as now`) as Array<Record<string, unknown>>;
      const value = rows[0]?.now;
      if (value instanceof Date && Number.isFinite(value.getTime())) return value;
    } catch {
      // Keep connection details out of the error surfaced to staff.
    }
  }
  throw new Error('The store database clock is unavailable. Please try again.');
}

/**
 * Parse report filters in the store timezone on the database clock. Pages and
 * export routes call this instead of `parseReportFilters` directly.
 */
export async function loadReportFilters(
  params: Record<string, string | undefined>,
): Promise<ReportFilterParse> {
  const [timeZone, now] = await Promise.all([getStoreTimeZone(), getDatabaseNow()]);
  return parseReportFilters(params, now, timeZone);
}

export { getStoreTimeZone };
