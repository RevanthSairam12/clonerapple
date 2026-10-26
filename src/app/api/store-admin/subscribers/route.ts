import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { addSubscriber, listSubscribers } from '@/lib/store-admin/subscribers';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const guard = await requireStoreRole('store_viewer');
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const result = await listSubscribers({
    query: url.searchParams.get('q') ?? '',
    status: (url.searchParams.get('status') ?? 'all') as 'all' | 'subscribed' | 'unsubscribed',
    page: Number.parseInt(url.searchParams.get('page') ?? '1', 10),
  });

  if (!result.ok) {
    return NextResponse.json({ error: 'Subscribers are not available.' }, { status: 503 });
  }
  return NextResponse.json(result.data, { headers: { 'Cache-Control': 'no-store' } });
}

/** Add an address captured by staff (for example an in-store sign-up). */
export async function POST(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  let body: { email?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const result = await addSubscriber(body.email);
  if (!result.ok) {
    if (result.reason === 'invalid-input') {
      return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
    }
    return NextResponse.json({ error: 'The subscriber could not be saved.' }, { status: 503 });
  }

  // The full address stays out of the audit row.
  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'subscriber.add',
    entity: 'newsletter_subscriber',
    entityId: result.data.id,
    after: { email: result.data.emailMasked, status: result.data.status },
    reason: 'staff_captured_consent',
    request,
  });

  return NextResponse.json(
    { ok: true, id: result.data.id, status: result.data.status },
    { status: result.data.status === 'added' ? 201 : 200 },
  );
}
