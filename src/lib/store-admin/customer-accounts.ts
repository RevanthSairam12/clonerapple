import { getSql } from '@/lib/admin/db';

import { anonymisedEmail } from './customer-rules';
import { maskCustomerEmail } from './masking';

/**
 * Account-level operations for the Customers section: the registered account
 * list, session and login-history views, revoking sessions, blocking an
 * account and anonymising one.
 *
 * The session id shown to staff is the first 12 hex characters of the stored
 * SHA-256 token hash. It identifies a row without being a usable credential:
 * the server only ever authenticates by hashing a presented 256-bit token and
 * comparing the result.
 */

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Customer account operations run on the server only.');
}

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return text(value);
}

function nullableIso(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = iso(value);
  return parsed || null;
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export const ACCOUNTS_PAGE_SIZE = 25;

/* --------------------------------------------------------- account list */

export interface AccountSummary {
  id: string;
  name: string;
  emailMasked: string;
  joinedAt: string;
  lastLoginAt: string | null;
  sessionCount: number;
  orderCount: number;
  status: 'active' | 'blocked';
}

export interface AccountListData {
  accounts: AccountSummary[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  query: string;
  status: 'all' | 'active' | 'blocked';
}

export type AccountLoad<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'unavailable' | 'not-found' | 'conflict' };

export async function listAccounts(options: {
  query?: string;
  status?: 'all' | 'active' | 'blocked';
  page?: number;
}): Promise<AccountLoad<AccountListData>> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  const search = (options.query ?? '').trim().slice(0, 100);
  const status = options.status ?? 'all';
  const requestedPage = Math.max(1, Math.trunc(options.page ?? 1) || 1);
  const offset = (requestedPage - 1) * ACCOUNTS_PAGE_SIZE;
  const pattern = `%${escapeLike(search)}%`;

  try {
    const rows = (await sql`
      select u.id, u.email, u.first_name, u.last_name, u.created_at,
             u.last_login_at, u.is_blocked,
             coalesce(s.session_count, 0) as session_count,
             coalesce(o.order_count, 0) as order_count,
             count(*) over() as total
      from users u
      left join lateral (
        select count(*)::int as session_count
        from user_sessions s
        where s.user_id = u.id and s.expires_at > now()
      ) s on true
      left join lateral (
        select count(*)::int as order_count
        from orders o
        where o.user_id = u.id
      ) o on true
      where (
        ${search} = ''
        or u.email ilike ${pattern}
        or (u.first_name || ' ' || u.last_name) ilike ${pattern}
      )
        and (${status} = 'all' or (${status} = 'blocked') = u.is_blocked)
      order by u.created_at desc, u.id
      limit ${ACCOUNTS_PAGE_SIZE} offset ${offset}
    `) as Row[];

    const total = rows.length > 0 ? number(rows[0].total) : 0;
    const pageCount = Math.max(1, Math.ceil(total / ACCOUNTS_PAGE_SIZE));

    return {
      ok: true,
      data: {
        accounts: rows.map((row) => ({
          id: text(row.id),
          name:
            [text(row.first_name), text(row.last_name)].filter(Boolean).join(' ').trim() ||
            '(no name)',
          emailMasked: maskCustomerEmail(text(row.email)),
          joinedAt: iso(row.created_at),
          lastLoginAt: nullableIso(row.last_login_at),
          sessionCount: number(row.session_count),
          orderCount: number(row.order_count),
          status:
            row.is_blocked === true || text(row.is_blocked) === 'true'
              ? 'blocked'
              : 'active',
        })),
        total,
        page: Math.min(requestedPage, pageCount),
        pageCount,
        pageSize: ACCOUNTS_PAGE_SIZE,
        query: search,
        status,
      },
    };
  } catch {
    console.warn('[store-admin/customer-accounts] could not read the account list');
    return { ok: false, reason: 'unavailable' };
  }
}

/* ------------------------------------------------------ sessions history */

export interface AccountSession {
  /** First 12 hex characters of the token hash — not a usable token. */
  id: string;
  device: string;
  createdAt: string;
  expiresAt: string;
  expired: boolean;
}

export interface AccountLoginEvent {
  id: number;
  outcome: string;
  device: string;
  createdAt: string;
}

export interface AccountSecurity {
  sessions: AccountSession[];
  events: AccountLoginEvent[];
}

export async function getAccountSecurity(
  customerId: string,
): Promise<AccountLoad<AccountSecurity>> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  const id = customerId.trim();
  if (!id) return { ok: false, reason: 'not-found' };

  try {
    const [sessionRows, eventRows] = await Promise.all([
      sql`
        select left(token_hash, 12) as session_id, device, created_at, expires_at
        from user_sessions
        where user_id = ${id}
        order by created_at desc
        limit 50
      `,
      sql`
        select id, outcome, device, created_at
        from user_login_events
        where user_id = ${id}
        order by created_at desc, id desc
        limit 100
      `,
    ]);

    const now = Date.now();
    return {
      ok: true,
      data: {
        sessions: (sessionRows as Row[]).map((row) => {
          const expiresAt = iso(row.expires_at);
          return {
            id: text(row.session_id),
            device: text(row.device) || 'Unknown device',
            createdAt: iso(row.created_at),
            expiresAt,
            expired: Date.parse(expiresAt) <= now,
          };
        }),
        events: (eventRows as Row[]).map((row) => ({
          id: number(row.id),
          outcome: text(row.outcome),
          device: text(row.device) || 'Unknown device',
          createdAt: iso(row.created_at),
        })),
      },
    };
  } catch {
    console.warn('[store-admin/customer-accounts] could not read account security');
    return { ok: false, reason: 'unavailable' };
  }
}

/** Delete one session by its 12-hex display id, or every session when null. */
export async function revokeCustomerSessions(
  customerId: string,
  sessionId: string | null,
): Promise<{ ok: true; revoked: number } | { ok: false; reason: 'unavailable' | 'invalid-input' }> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  const id = customerId.trim();
  if (!id) return { ok: false, reason: 'invalid-input' };

  try {
    if (sessionId === null) {
      const rows = (await sql`
        delete from user_sessions where user_id = ${id} returning token_hash
      `) as Row[];
      return { ok: true, revoked: rows.length };
    }

    if (!/^[0-9a-f]{12}$/.test(sessionId)) {
      return { ok: false, reason: 'invalid-input' };
    }
    const rows = (await sql`
      delete from user_sessions
      where user_id = ${id} and left(token_hash, 12) = ${sessionId}
      returning token_hash
    `) as Row[];
    return { ok: true, revoked: rows.length };
  } catch {
    console.warn('[store-admin/customer-accounts] could not revoke sessions');
    return { ok: false, reason: 'unavailable' };
  }
}

/* ------------------------------------------------------------- block */

export interface BlockResult {
  ok: true;
  customerId: string;
  before: { blocked: boolean };
  after: { blocked: boolean; reason: string };
  revokedSessions: number;
}

export async function setCustomerBlocked(options: {
  customerId: string;
  blocked: boolean;
  reason: string;
}): Promise<BlockResult | { ok: false; reason: 'unavailable' | 'not-found' }> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  const id = options.customerId.trim();
  if (!id) return { ok: false, reason: 'not-found' };

  try {
    return await sql.begin(async (tx) => {
      const rows = (await tx`
        select id, is_blocked from users where id = ${id} for update
      `) as Row[];
      const row = rows[0];
      if (!row) return { ok: false as const, reason: 'not-found' as const };

      const beforeBlocked = row.is_blocked === true || text(row.is_blocked) === 'true';

      await tx`
        update users
        set is_blocked = ${options.blocked},
            blocked_at = case when ${options.blocked} then now() else null end,
            blocked_reason = ${options.blocked ? options.reason : ''},
            updated_at = now()
        where id = ${id}
      `;

      let revoked = 0;
      if (options.blocked) {
        const deleted = (await tx`
          delete from user_sessions where user_id = ${id} returning token_hash
        `) as Row[];
        revoked = deleted.length;
      }

      return {
        ok: true as const,
        customerId: id,
        before: { blocked: beforeBlocked },
        after: { blocked: options.blocked, reason: options.blocked ? options.reason : '' },
        revokedSessions: revoked,
      };
    });
  } catch {
    console.warn('[store-admin/customer-accounts] could not change the block state');
    return { ok: false, reason: 'unavailable' };
  }
}

/* --------------------------------------------------------- anonymise */

export interface AnonymiseResult {
  ok: true;
  customerId: string;
  wasBlocked: boolean;
  addressesRemoved: number;
  sessionsRevoked: number;
}

/**
 * Replace the account's identifying fields and end every session.
 *
 * Kept on purpose: order rows (financial records), internal staff notes.
 * Removed: name, phone, saved addresses, sessions, newsletter consent.
 */
export async function anonymiseCustomer(
  customerId: string,
): Promise<AnonymiseResult | { ok: false; reason: 'unavailable' | 'not-found' | 'conflict' }> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  const id = customerId.trim();
  if (!id) return { ok: false, reason: 'not-found' };

  try {
    return await sql.begin(async (tx) => {
      const rows = (await tx`
        select id, email, is_blocked, anonymised_at
        from users
        where id = ${id}
        for update
      `) as Row[];
      const row = rows[0];
      if (!row) return { ok: false as const, reason: 'not-found' as const };
      if (row.anonymised_at) return { ok: false as const, reason: 'conflict' as const };

      const previousEmail = text(row.email).trim().toLowerCase();
      const wasBlocked = row.is_blocked === true || text(row.is_blocked) === 'true';

      const addresses = (await tx`
        delete from customer_addresses where user_id = ${id} returning id
      `) as Row[];
      const sessions = (await tx`
        delete from user_sessions where user_id = ${id} returning token_hash
      `) as Row[];

      if (previousEmail) {
        await tx`
          update newsletter_subscribers
          set unsubscribed_at = now(),
              unsubscribe_reason = 'Account anonymised',
              updated_at = now()
          where email = ${previousEmail} and unsubscribed_at is null
        `;
      }

      await tx`
        update users
        set email = ${anonymisedEmail(id)},
            first_name = '',
            last_name = '',
            phone = null,
            is_blocked = true,
            blocked_at = now(),
            blocked_reason = 'Account anonymised',
            anonymised_at = now(),
            customer_group = 'retail',
            marketing_opt_in = false,
            updated_at = now()
        where id = ${id}
      `;

      return {
        ok: true as const,
        customerId: id,
        wasBlocked,
        addressesRemoved: addresses.length,
        sessionsRevoked: sessions.length,
      };
    });
  } catch {
    console.warn('[store-admin/customer-accounts] could not anonymise the account');
    return { ok: false, reason: 'unavailable' };
  }
}
