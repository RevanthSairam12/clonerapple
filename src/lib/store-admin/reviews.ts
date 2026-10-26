import { getSql } from '@/lib/admin/db';

import type { CatalogWrite } from './catalog-writes';
import {
  canTransitionReview,
  isReviewStatus,
  maskEmail,
  rejectionReasonError,
  replyError,
  type ReviewStatus,
} from './review-rules';

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Reviews are moderated on the server only.');
}

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableText(value: unknown): string | null {
  const result = text(value).trim();
  return result || null;
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return text(value);
}

function fail(
  reason: 'unavailable' | 'invalid-input' | 'not-found' | 'conflict',
  error: string,
): { ok: false; reason: 'unavailable' | 'invalid-input' | 'not-found' | 'conflict'; error: string } {
  return { ok: false, reason, error };
}

export interface ReviewRow {
  id: string;
  orderId: string | null;
  customerName: string;
  customerEmail: string;
  productId: string;
  productName: string;
  productSlug: string;
  rating: number;
  title: string;
  body: string;
  verifiedPurchase: boolean;
  status: ReviewStatus;
  rejectionReason: string;
  storeReply: string;
  repliedAt: string | null;
  repliedBy: string | null;
  createdAt: string;
}

interface ReviewJoin {
  filter: string;
  params: unknown[];
}

function reviewSelect(): string {
  return `
    select r.id, r.order_id, r.customer_name, r.customer_email, r.product_id,
           p.name as product_name, p.slug as product_slug, r.rating, r.title, r.body,
           r.verified_purchase, r.status, r.rejection_reason, r.store_reply,
           r.replied_at, r.replied_by, r.created_at
    from product_reviews r
    join products p on p.id = r.product_id
  `;
}

function mapReview(row: Row): ReviewRow {
  return {
    id: text(row.id),
    orderId: nullableText(row.order_id),
    customerName: text(row.customer_name) || 'Customer',
    customerEmail: maskEmail(text(row.customer_email)),
    productId: text(row.product_id),
    productName: text(row.product_name),
    productSlug: text(row.product_slug),
    rating: number(row.rating),
    title: text(row.title),
    body: text(row.body),
    verifiedPurchase: Boolean(row.verified_purchase),
    status: (isReviewStatus(row.status) ? row.status : 'pending') as ReviewStatus,
    rejectionReason: text(row.rejection_reason),
    storeReply: text(row.store_reply),
    repliedAt: row.replied_at ? iso(row.replied_at) : null,
    repliedBy: nullableText(row.replied_by),
    createdAt: iso(row.created_at),
  };
}

export interface ReviewsLoad {
  reviews: ReviewRow[];
  counts: Record<ReviewStatus, number>;
  total: number;
}

export async function listReviews(options: {
  status: ReviewStatus | null;
  search: string;
  limit: number;
}): Promise<CatalogWrite<ReviewsLoad>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'Reviews are not available.');

  const limit = Math.min(Math.max(1, Math.trunc(options.limit)), 200);
  const search = options.search.trim().slice(0, 100);

  try {
    const countsRows = (await sql`
      select status, count(*)::int as n from product_reviews group by status
    `) as Row[];
    const counts: Record<ReviewStatus, number> = { pending: 0, published: 0, rejected: 0 };
    for (const row of countsRows) {
      if (isReviewStatus(row.status)) counts[row.status] = number(row.n);
    }

    const clauses: string[] = [];
    const params: unknown[] = [];
    if (options.status) {
      params.push(options.status);
      clauses.push(`r.status = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      clauses.push(`(p.name ilike $${params.length} or r.title ilike $${params.length} or r.body ilike $${params.length})`);
    }
    const where = clauses.length > 0 ? `where ${clauses.join(' and ')}` : '';
    params.push(limit);

    const rows = (await sql.unsafe(
      `${reviewSelect()} ${where} order by r.created_at desc, r.id desc limit $${params.length}`,
      params as never[],
    )) as Row[];

    return { ok: true, data: { reviews: rows.map(mapReview), counts, total: counts.pending + counts.published + counts.rejected } };
  } catch {
    console.warn('[store-admin/reviews] could not read reviews');
    return fail('unavailable', 'Reviews are not available.');
  }
}

export async function getReview(id: string): Promise<CatalogWrite<ReviewRow>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'Reviews are not available.');
  try {
    const rows = (await sql.unsafe(`${reviewSelect()} where r.id = $1 limit 1`, [id])) as Row[];
    if (!rows[0]) return fail('not-found', 'Review not found.');
    return { ok: true, data: mapReview(rows[0]) };
  } catch {
    console.warn('[store-admin/reviews] could not read a review');
    return fail('unavailable', 'Reviews are not available.');
  }
}

export interface ReviewChange {
  before: Row;
  after: Row;
}

/** Publish or reject. A rejection always carries a reason. */
export async function setReviewStatus(input: {
  id: string;
  action: 'publish' | 'reject';
  reason: string;
}): Promise<CatalogWrite<ReviewChange>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'Reviews are not available.');

  const target: ReviewStatus = input.action === 'publish' ? 'published' : 'rejected';
  if (input.action === 'reject') {
    const reasonError = rejectionReasonError(input.reason);
    if (reasonError) return fail('invalid-input', reasonError);
  }

  try {
    return await sql.begin(async (tx) => {
      const rows = (await tx`
        select * from product_reviews where id = ${input.id} for update
      `) as Row[];
      const before = rows[0];
      if (!before) return fail('not-found', 'Review not found.');

      const from = isReviewStatus(before.status) ? before.status : 'pending';
      if (!canTransitionReview(from, target)) {
        return fail('conflict', `A ${from} review cannot become ${target}.`);
      }

      const updated = (await tx`
        update product_reviews
        set status = ${target},
            rejection_reason = ${input.action === 'reject' ? input.reason.trim() : ''},
            updated_at = now()
        where id = ${input.id}
        returning *
      `) as Row[];

      return { ok: true as const, data: { before, after: updated[0] ?? {} } };
    });
  } catch {
    console.warn('[store-admin/reviews] could not moderate a review');
    return fail('unavailable', 'Reviews are not available.');
  }
}

/** Publish the store's public reply. Replies can be edited; the author is replaced. */
export async function setReviewReply(input: {
  id: string;
  reply: string;
  staffId: string;
}): Promise<CatalogWrite<ReviewChange>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'Reviews are not available.');
  const replyProblem = replyError(input.reply);
  if (replyProblem) return fail('invalid-input', replyProblem);

  try {
    return await sql.begin(async (tx) => {
      const rows = (await tx`
        select * from product_reviews where id = ${input.id} for update
      `) as Row[];
      const before = rows[0];
      if (!before) return fail('not-found', 'Review not found.');

      const updated = (await tx`
        update product_reviews
        set store_reply = ${input.reply.trim()},
            replied_at = now(),
            replied_by = ${input.staffId},
            updated_at = now()
        where id = ${input.id}
        returning *
      `) as Row[];
      return { ok: true as const, data: { before, after: updated[0] ?? {} } };
    });
  } catch {
    console.warn('[store-admin/reviews] could not save a reply');
    return fail('unavailable', 'Reviews are not available.');
  }
}
