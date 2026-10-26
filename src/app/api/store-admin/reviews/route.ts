import { NextResponse } from 'next/server';

import { requireStoreRole } from '@/lib/store-admin/auth';
import { isReviewStatus } from '@/lib/store-admin/review-rules';
import { listReviews } from '@/lib/store-admin/reviews';

/**
 * Customer reviews with per-status counts. Read-only: moderation happens on
 * `/api/store-admin/reviews/[id]`. Customer emails are masked before they
 * leave the server.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const guard = await requireStoreRole();
  if (!guard.ok) return guard.response;

  const params = new URL(request.url).searchParams;
  const requested = params.get('status') ?? '';
  const status = isReviewStatus(requested) ? requested : null;
  const parsed = Number(params.get('limit'));
  const limit = Number.isInteger(parsed) && parsed > 0 ? parsed : 100;

  const result = await listReviews({
    status,
    search: params.get('q') ?? '',
    limit,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 503 });
  }
  return NextResponse.json(result.data);
}
