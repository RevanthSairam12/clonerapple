import { randomBytes } from 'node:crypto';

import { getSql } from '@/lib/admin/db';

import {
  isSubscriberSource,
  validateSubscriberEmail,
  type SubscriberSource,
} from './customer-rules';
import { maskCustomerEmail } from './masking';

/**
 * Newsletter subscribers.
 *
 * Emails are masked in every read path the panel renders. The single place
 * that returns full addresses is `listSubscriberEmails()`, which only the
 * owner-only, audited export route calls.
 */

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Subscribers must be read and written on the server only.');
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

export const SUBSCRIBERS_PAGE_SIZE = 25;

export type SubscriberStatus = 'all' | 'subscribed' | 'unsubscribed';

export interface SubscriberSummary {
  id: string;
  emailMasked: string;
  source: SubscriberSource;
  subscribedAt: string;
  unsubscribedAt: string | null;
}

export interface SubscriberListData {
  subscribers: SubscriberSummary[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  query: string;
  status: SubscriberStatus;
  counts: { subscribed: number; unsubscribed: number };
}

export type SubscriberLoad<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'unavailable' | 'not-found' | 'invalid-input' };

export function isSubscriberStatus(value: unknown): value is SubscriberStatus {
  return value === 'all' || value === 'subscribed' || value === 'unsubscribed';
}

export async function listSubscribers(options: {
  query?: string;
  status?: SubscriberStatus;
  page?: number;
}): Promise<SubscriberLoad<SubscriberListData>> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  const search = (options.query ?? '').trim().slice(0, 100);
  const status: SubscriberStatus = isSubscriberStatus(options.status)
    ? options.status
    : 'all';
  const requestedPage = Math.max(1, Math.trunc(options.page ?? 1) || 1);
  const offset = (requestedPage - 1) * SUBSCRIBERS_PAGE_SIZE;
  const pattern = `%${escapeLike(search)}%`;

  try {
    const rows = (await sql`
      select id, email, source, subscribed_at, unsubscribed_at,
             count(*) over() as total
      from newsletter_subscribers
      where (${search} = '' or email ilike ${pattern})
        and (
          ${status} = 'all'
          or (${status} = 'subscribed') = (unsubscribed_at is null)
        )
      order by subscribed_at desc, id
      limit ${SUBSCRIBERS_PAGE_SIZE} offset ${offset}
    `) as Row[];

    const countRows = (await sql`
      select
        count(*) filter (where unsubscribed_at is null)::int as subscribed,
        count(*) filter (where unsubscribed_at is not null)::int as unsubscribed
      from newsletter_subscribers
    `) as Row[];
    const counts = countRows[0] ?? {};

    const total = rows.length > 0 ? number(rows[0].total) : 0;
    const pageCount = Math.max(1, Math.ceil(total / SUBSCRIBERS_PAGE_SIZE));

    return {
      ok: true,
      data: {
        subscribers: rows.map((row) => ({
          id: text(row.id),
          emailMasked: maskCustomerEmail(text(row.email)),
          source: (isSubscriberSource(row.source) ? row.source : 'storefront') as SubscriberSource,
          subscribedAt: iso(row.subscribed_at),
          unsubscribedAt: nullableIso(row.unsubscribed_at),
        })),
        total,
        page: Math.min(requestedPage, pageCount),
        pageCount,
        pageSize: SUBSCRIBERS_PAGE_SIZE,
        query: search,
        status,
        counts: {
          subscribed: number(counts.subscribed),
          unsubscribed: number(counts.unsubscribed),
        },
      },
    };
  } catch {
    console.warn('[store-admin/subscribers] could not read subscribers');
    return { ok: false, reason: 'unavailable' };
  }
}

/* ------------------------------------------------------ storefront opt-in */

export interface SubscribeResult {
  status: 'subscribed' | 'already' | 'unavailable';
}

/**
 * Public opt-in. Never throws and never reveals whether an address was already
 * on the list beyond the generic `already` answer.
 */
export async function subscribeToNewsletter(
  email: string,
  source: SubscriberSource,
): Promise<SubscribeResult> {
  const validation = validateSubscriberEmail(email);
  if (!validation.ok) return { status: 'unavailable' };

  const sql = getSql();
  if (!sql) return { status: 'unavailable' };

  try {
    const rows = (await sql`
      insert into newsletter_subscribers (id, email, source, consent_at, subscribed_at)
      values (
        ${`sub_${randomBytes(10).toString('hex')}`},
        ${validation.email},
        ${isSubscriberSource(source) ? source : 'storefront'},
        now(), now()
      )
      on conflict (email) do nothing
      returning id
    `) as Row[];
    return { status: rows.length > 0 ? 'subscribed' : 'already' };
  } catch {
    console.warn('[store-admin/subscribers] could not record a newsletter opt-in');
    return { status: 'unavailable' };
  }
}

/* ------------------------------------------------------------- actions */

export async function unsubscribeSubscriber(
  id: string,
  reason: string,
): Promise<SubscriberLoad<{ id: string; before: 'subscribed'; after: 'unsubscribed' }>> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  try {
    const rows = (await sql`
      update newsletter_subscribers
      set unsubscribed_at = now(),
          unsubscribe_reason = ${reason},
          updated_at = now()
      where id = ${id} and unsubscribed_at is null
      returning id
    `) as Row[];
    if (!rows[0]) return { ok: false, reason: 'not-found' };
    return { ok: true, data: { id: text(rows[0].id), before: 'subscribed', after: 'unsubscribed' } };
  } catch {
    console.warn('[store-admin/subscribers] could not unsubscribe');
    return { ok: false, reason: 'unavailable' };
  }
}

export async function resubscribeSubscriber(
  id: string,
): Promise<SubscriberLoad<{ id: string; before: 'unsubscribed'; after: 'subscribed' }>> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  try {
    const rows = (await sql`
      update newsletter_subscribers
      set unsubscribed_at = null,
          unsubscribe_reason = '',
          updated_at = now()
      where id = ${id} and unsubscribed_at is not null
      returning id
    `) as Row[];
    if (!rows[0]) return { ok: false, reason: 'not-found' };
    return { ok: true, data: { id: text(rows[0].id), before: 'unsubscribed', after: 'subscribed' } };
  } catch {
    console.warn('[store-admin/subscribers] could not resubscribe');
    return { ok: false, reason: 'unavailable' };
  }
}

/**
 * Add an address collected by staff (for example an in-store sign-up). An
 * existing unsubscribed address is left unsubscribed: staff cannot override a
 * customer's opt-out from this action.
 */
export async function addSubscriber(
  email: unknown,
): Promise<SubscriberLoad<{ id: string; emailMasked: string; status: 'added' | 'existing' | 'unsubscribed' }>> {
  const validation = validateSubscriberEmail(email);
  if (!validation.ok) return { ok: false, reason: 'invalid-input' };

  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  try {
    const inserted = (await sql`
      insert into newsletter_subscribers (id, email, source, consent_at, subscribed_at)
      values (
        ${`sub_${randomBytes(10).toString('hex')}`},
        ${validation.email}, 'manual', now(), now()
      )
      on conflict (email) do nothing
      returning id
    `) as Row[];

    if (inserted[0]) {
      return {
        ok: true,
        data: {
          id: text(inserted[0].id),
          emailMasked: maskCustomerEmail(validation.email),
          status: 'added',
        },
      };
    }

    const existing = (await sql`
      select id, unsubscribed_at from newsletter_subscribers
      where email = ${validation.email}
      limit 1
    `) as Row[];
    const row = existing[0];
    if (!row) return { ok: false, reason: 'unavailable' };
    return {
      ok: true,
      data: {
        id: text(row.id),
        emailMasked: maskCustomerEmail(validation.email),
        status: row.unsubscribed_at ? 'unsubscribed' : 'existing',
      },
    };
  } catch {
    console.warn('[store-admin/subscribers] could not add a subscriber');
    return { ok: false, reason: 'unavailable' };
  }
}

/* -------------------------------------------------------------- export */

export interface SubscriberExportRow {
  email: string;
  source: string;
  subscribedAt: string;
  unsubscribedAt: string | null;
}

/** Full addresses — owner-only, audited export. */
export async function listSubscriberEmails(
  status: SubscriberStatus,
): Promise<SubscriberLoad<SubscriberExportRow[]>> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  try {
    const rows = (await sql`
      select email, source, subscribed_at, unsubscribed_at
      from newsletter_subscribers
      where (
        ${status} = 'all'
        or (${status} = 'subscribed') = (unsubscribed_at is null)
      )
      order by subscribed_at desc
      limit 50000
    `) as Row[];
    return {
      ok: true,
      data: rows.map((row) => ({
        email: text(row.email),
        source: text(row.source),
        subscribedAt: iso(row.subscribed_at),
        unsubscribedAt: nullableIso(row.unsubscribed_at),
      })),
    };
  } catch {
    console.warn('[store-admin/subscribers] could not export subscribers');
    return { ok: false, reason: 'unavailable' };
  }
}
