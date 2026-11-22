import { NextResponse } from 'next/server';

import { getSql } from '@/lib/platform/db';
import { checkDistributedRateLimit } from '@/lib/platform/distributed-rate-limit';
import {
  PRIVATE_RECEIPT_BUCKET,
  PUBLIC_MEDIA_BUCKET,
  createSignedStorageUrl,
  type StorageBucket,
} from '@/lib/platform/storage';
import { writeAudit } from '@/lib/store-admin/audit';
import { requireStoreRole } from '@/lib/store-admin/auth';

/**
 * Authenticated expense receipt access (`GET /api/store-admin/expenses/[id]/receipt`).
 *
 * Requires `store_admin` (or `store_owner`), enforces a distributed per-actor
 * rate limit, mints a short-lived (60s) Supabase Storage signed URL, audits the
 * access without recording signed URLs/filenames, and returns `Cache-Control: private, no-store`.
 */
export const dynamic = 'force-dynamic';

const RECEIPT_VIEW_LIMIT = { limit: 30, windowMs: 10 * 60 * 1000 } as const;
const SIGNED_URL_TTL_SEC = 60;
const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";
const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store',
  Pragma: 'no-cache',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  Vary: 'Cookie',
} as const;

function attachmentName(filename: unknown, id: string): string {
  const raw = typeof filename === 'string' ? filename : '';
  const base = raw.replace(/[^A-Za-z0-9._ -]/g, '').trim().slice(0, 120);
  const name = base || `receipt-${id}`;
  return name.toLowerCase().endsWith('.svg') ? name : `${name}.svg`;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const expenseId = (id || '').trim();
  if (!expenseId) {
    return NextResponse.json(
      { error: 'Expense receipt not found.' },
      { status: 404, headers: PRIVATE_HEADERS },
    );
  }

  const rate = await checkDistributedRateLimit({
    scope: 'expense_receipt_view_actor',
    key: guard.session.adminId,
    ...RECEIPT_VIEW_LIMIT,
  });
  if (!rate.allowed) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'expense.receipt.view',
      entity: 'expense',
      entityId: expenseId,
      status: 'denied',
      reason: 'rate_limited',
      request,
    });
    return NextResponse.json(
      { error: 'Too many receipt requests. Please wait before trying again.' },
      {
        status: 429,
        headers: {
          ...PRIVATE_HEADERS,
          'Retry-After': String(Math.max(1, rate.retryAfterSec)),
        },
      },
    );
  }

  const sql = getSql();
  if (!sql) {
    return NextResponse.json(
      { error: 'Expense receipts are temporarily unavailable.' },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }

  try {
    const rows = (await sql`
      select
        m.id as media_id,
        m.filename,
        m.mime_type,
        m.storage_path,
        coalesce(to_jsonb(m)->>'bucket', 'media') as bucket
      from expenses e
      join store_media m on m.id = e.attachment_media_id and m.deleted_at is null
      where e.id = ${expenseId}
        and e.deleted_at is null
      limit 1
    `) as Array<Record<string, unknown>>;

    const row = rows[0];
    const storagePath = row?.storage_path ? String(row.storage_path).trim() : '';
    if (!row || !storagePath) {
      return NextResponse.json(
        { error: 'Expense receipt not found.' },
        { status: 404, headers: PRIVATE_HEADERS },
      );
    }

    const bucket: StorageBucket =
      row.bucket === PRIVATE_RECEIPT_BUCKET ? PRIVATE_RECEIPT_BUCKET : PUBLIC_MEDIA_BUCKET;
    const mediaId = String(row.media_id);
    const mimeType = String(row.mime_type ?? '');

    const signedUrl = await createSignedStorageUrl(storagePath, {
      bucket,
      expiresInSec: SIGNED_URL_TTL_SEC,
    });
    if (!signedUrl) {
      return NextResponse.json(
        { error: 'Could not prepare receipt download.' },
        { status: 503, headers: PRIVATE_HEADERS },
      );
    }

    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'expense.receipt.view',
      entity: 'expense',
      entityId: expenseId,
      after: { attachmentId: mediaId, bucket },
      reason: 'receipt_access',
      request,
    });

    const isSvg = mimeType === 'image/svg+xml' || storagePath.toLowerCase().endsWith('.svg');
    if (isSvg) {
      const object = await fetch(signedUrl, { cache: 'no-store' });
      if (!object.ok || !object.body) {
        return NextResponse.json(
          { error: 'Expense receipt not found.' },
          { status: 404, headers: PRIVATE_HEADERS },
        );
      }
      return new Response(object.body, {
        status: 200,
        headers: {
          ...PRIVATE_HEADERS,
          'Content-Type': 'image/svg+xml',
          'Content-Disposition': `attachment; filename="${attachmentName(row.filename, mediaId)}"`,
          'Content-Security-Policy': SVG_CSP,
        },
      });
    }

    return new Response(null, {
      status: 302,
      headers: {
        ...PRIVATE_HEADERS,
        Location: signedUrl,
      },
    });
  } catch {
    console.warn('[store-admin/expenses/receipt] could not resolve receipt');
    return NextResponse.json(
      { error: 'Could not load expense receipt.' },
      { status: 500, headers: PRIVATE_HEADERS },
    );
  }
}
