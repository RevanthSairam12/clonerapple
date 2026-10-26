import { getSql } from '@/lib/admin/db';

/**
 * Read model for `store_admin_audit`.
 *
 * The table is append-only at the database level (0010), so this module has
 * one shape of query and no writes at all. `actor_email` is already masked at
 * write time; nothing here can unmask it.
 */

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: The audit log must be read on the server only.');
}

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function nullableText(value: unknown): string | null {
  const result = text(value).trim();
  return result || null;
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return text(value);
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export const AUDIT_PAGE_SIZE = 100;
export const AUDIT_MAX_RANGE_DAYS = 366;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isAuditDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export interface AuditFilters {
  actor: string;
  action: string;
  entity: string;
  entityId: string;
  fromDay: string;
  toDay: string;
  page: number;
}

export type AuditFilterResult =
  | { ok: true; filters: AuditFilters }
  | { ok: false; error: string };

function dayString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Parse query-string filters; defaults to the last seven days. */
export function parseAuditFilters(
  input: Record<string, unknown>,
  now = new Date(),
): AuditFilterResult {
  const rawFrom = typeof input.from === 'string' ? input.from : '';
  const rawTo = typeof input.to === 'string' ? input.to : '';

  const toDay = rawTo && isAuditDate(rawTo) ? rawTo : dayString(now);
  const weekAgo = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
  const fromDay = rawFrom && isAuditDate(rawFrom) ? rawFrom : dayString(weekAgo);

  if (fromDay > toDay) {
    return { ok: false, error: 'The start date must be on or before the end date.' };
  }

  const from = Date.UTC(
    Number(fromDay.slice(0, 4)),
    Number(fromDay.slice(5, 7)) - 1,
    Number(fromDay.slice(8, 10)),
  );
  const to = Date.UTC(
    Number(toDay.slice(0, 4)),
    Number(toDay.slice(5, 7)) - 1,
    Number(toDay.slice(8, 10)),
  );
  const days = Math.floor((to - from) / 86_400_000) + 1;
  if (days > AUDIT_MAX_RANGE_DAYS) {
    return { ok: false, error: `Choose a range of ${AUDIT_MAX_RANGE_DAYS} days or fewer.` };
  }

  const pageRaw = Number(input.page);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.trunc(pageRaw) : 1;

  return {
    ok: true,
    filters: {
      actor: typeof input.actor === 'string' ? input.actor.trim().slice(0, 120) : '',
      action: typeof input.action === 'string' ? input.action.trim().slice(0, 120) : '',
      entity: typeof input.entity === 'string' ? input.entity.trim().slice(0, 80) : '',
      entityId: typeof input.entityId === 'string' ? input.entityId.trim().slice(0, 120) : '',
      fromDay,
      toDay,
      page,
    },
  };
}

export interface AuditLogRow {
  id: number;
  createdAt: string;
  actorId: string | null;
  actorEmail: string;
  action: string;
  entity: string;
  entityId: string;
  status: string;
  reason: string;
  route: string;
  requestId: string | null;
  ipHash: string | null;
  userAgentHash: string | null;
  before: unknown;
  after: unknown;
}

export interface AuditLogPage {
  rows: AuditLogRow[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
}

export type AuditLoad<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'unavailable' };

function rowFromRecord(row: Row): AuditLogRow {
  return {
    id: number(row.id),
    createdAt: iso(row.created_at),
    actorId: nullableText(row.actor_id),
    actorEmail: text(row.actor_email),
    action: text(row.action),
    entity: text(row.entity),
    entityId: text(row.entity_id),
    status: text(row.status),
    reason: text(row.reason),
    route: text(row.route),
    requestId: nullableText(row.request_id),
    ipHash: nullableText(row.ip_hash),
    userAgentHash: nullableText(row.user_agent_hash),
    before: row.before ?? null,
    after: row.after ?? null,
  };
}

export async function listAuditLog(filters: AuditFilters): Promise<AuditLoad<AuditLogPage>> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  const offset = (filters.page - 1) * AUDIT_PAGE_SIZE;

  try {
    // The conditions are written as "blank means any" so one prepared shape
    // serves every filter combination.
    const rows = (await sql`
      select id, created_at, actor_id, actor_email, action, entity, entity_id,
             status, reason, route, request_id, ip_hash, user_agent_hash,
             before, after,
             count(*) over() as total
      from store_admin_audit
      where created_at >= ${filters.fromDay}::date
        and created_at < (${filters.toDay}::date + interval '1 day')
        and (${filters.actor}::text = '' or actor_id = ${filters.actor}::text
             or actor_email ilike ${'%' + filters.actor + '%'})
        and (${filters.action}::text = '' or action = ${filters.action}::text)
        and (${filters.entity}::text = '' or entity = ${filters.entity}::text)
        and (${filters.entityId}::text = '' or entity_id = ${filters.entityId}::text)
      order by created_at desc, id desc
      limit ${AUDIT_PAGE_SIZE} offset ${offset}
    `) as Row[];

    const total = rows.length > 0 ? number(rows[0].total) : 0;
    const pageCount = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));

    return {
      ok: true,
      data: {
        rows: rows.map(rowFromRecord),
        total,
        page: Math.min(filters.page, pageCount),
        pageCount,
        pageSize: AUDIT_PAGE_SIZE,
      },
    };
  } catch {
    console.warn('[store-admin/audit-log] could not read the audit log');
    return { ok: false, reason: 'unavailable' };
  }
}

export interface AuditFacets {
  actions: { value: string; count: number }[];
  entities: { value: string; count: number }[];
}

/** Populate the filter dropdowns from what the log actually contains. */
export async function listAuditFacets(): Promise<AuditLoad<AuditFacets>> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  try {
    const [actions, entities] = await Promise.all([
      sql`
        select action as value, count(*)::int as count
        from store_admin_audit
        group by action
        order by count desc, action asc
        limit 200
      ` as Promise<Row[]>,
      sql`
        select entity as value, count(*)::int as count
        from store_admin_audit
        group by entity
        order by count desc, entity asc
        limit 100
      ` as Promise<Row[]>,
    ]);

    return {
      ok: true,
      data: {
        actions: actions.map((row) => ({ value: text(row.value), count: number(row.count) })),
        entities: entities.map((row) => ({ value: text(row.value), count: number(row.count) })),
      },
    };
  } catch {
    console.warn('[store-admin/audit-log] could not read audit facets');
    return { ok: false, reason: 'unavailable' };
  }
}

export interface AuditExport {
  rows: AuditLogRow[];
  truncated: boolean;
}

export const AUDIT_EXPORT_LIMIT = 5000;

/** The CSV export carries the same columns as the screen, capped and audited. */
export async function exportAuditLog(filters: AuditFilters): Promise<AuditLoad<AuditExport>> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  try {
    const rows = (await sql`
      select id, created_at, actor_id, actor_email, action, entity, entity_id,
             status, reason, route, request_id, ip_hash, user_agent_hash,
             before, after
      from store_admin_audit
      where created_at >= ${filters.fromDay}::date
        and created_at < (${filters.toDay}::date + interval '1 day')
        and (${filters.actor}::text = '' or actor_id = ${filters.actor}::text
             or actor_email ilike ${'%' + filters.actor + '%'})
        and (${filters.action}::text = '' or action = ${filters.action}::text)
        and (${filters.entity}::text = '' or entity = ${filters.entity}::text)
        and (${filters.entityId}::text = '' or entity_id = ${filters.entityId}::text)
      order by created_at desc, id desc
      limit ${AUDIT_EXPORT_LIMIT + 1}
    `) as Row[];

    return {
      ok: true,
      data: {
        rows: rows.slice(0, AUDIT_EXPORT_LIMIT).map(rowFromRecord),
        truncated: rows.length > AUDIT_EXPORT_LIMIT,
      },
    };
  } catch {
    console.warn('[store-admin/audit-log] could not export the audit log');
    return { ok: false, reason: 'unavailable' };
  }
}
