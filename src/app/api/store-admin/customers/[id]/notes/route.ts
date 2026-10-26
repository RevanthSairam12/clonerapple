import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import {
  addCustomerNote,
  listCustomerNotes,
  validateCustomerNoteBody,
} from '@/lib/store-admin/customer-notes';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await requireStoreRole('store_viewer');
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const result = await listCustomerNotes(id);
  if (!result.ok) {
    return NextResponse.json({ error: 'Notes are not available.' }, { status: 503 });
  }
  return NextResponse.json(
    { notes: result.data },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
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

  const validation = validateCustomerNoteBody(raw.body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const { id } = await context.params;
  const result = await addCustomerNote({
    customerId: id,
    body: validation.body,
    authorId: guard.session.adminId,
    authorName: guard.session.name,
    authorEmail: guard.session.email,
  });

  if (!result.ok) {
    if (result.reason === 'invalid-input') {
      return NextResponse.json({ error: 'Write a note before saving.' }, { status: 400 });
    }
    if (result.reason === 'not-found') {
      return NextResponse.json({ error: 'Customer not found.' }, { status: 404 });
    }
    return NextResponse.json({ error: 'The note could not be saved.' }, { status: 503 });
  }

  // The note text is never copied into the audit log: staff may type contact
  // details into it.
  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'customer.note.add',
    entity: 'customer',
    entityId: id,
    after: { noteId: result.data.id, length: result.data.body.length },
    reason: 'internal_customer_note',
    request,
  });

  return NextResponse.json({ note: result.data }, { status: 201 });
}
