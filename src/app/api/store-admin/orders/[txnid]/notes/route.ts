import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { addOrderNote, listOrderNotes, validateNoteBody } from '@/lib/store-admin/order-notes';
import { findOrderId } from '@/lib/store-admin/orders';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ txnid: string }> },
) {
  const guard = await requireStoreRole('store_viewer');
  if (!guard.ok) return guard.response;

  const { txnid } = await context.params;
  const orderId = await findOrderId(txnid);
  if (!orderId) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });

  const result = await listOrderNotes(orderId);
  if (!result.ok) {
    return NextResponse.json({ error: 'Notes are not available.' }, { status: 503 });
  }
  return NextResponse.json({ notes: result.data }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ txnid: string }> },
) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  let raw: { body?: unknown };
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const validation = validateNoteBody(raw.body);
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });

  const { txnid } = await context.params;
  const orderId = await findOrderId(txnid);
  if (!orderId) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });

  const result = await addOrderNote({
    orderId,
    body: validation.body,
    authorId: guard.session.adminId,
    authorName: guard.session.name,
    authorEmail: guard.session.email,
  });

  if (!result.ok) {
    const status = result.reason === 'invalid-input' ? 400 : 503;
    return NextResponse.json({ error: 'The note could not be saved.' }, { status });
  }

  // The note text itself is not copied into the audit log — it can contain
  // anything the staff member typed, including customer contact details.
  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'order.note.add',
    entity: 'order',
    entityId: orderId,
    after: { noteId: result.data.id, length: result.data.body.length },
    reason: 'internal_order_note',
    request,
  });

  return NextResponse.json({ note: result.data }, { status: 201 });
}
