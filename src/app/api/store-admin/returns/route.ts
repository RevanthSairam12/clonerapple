import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { createReturn, listReturns, type ReturnLineInput } from '@/lib/store-admin/returns';

export const dynamic = 'force-dynamic';

function statusForFailure(reason: string): number {
  if (reason === 'not-found') return 404;
  if (reason === 'invalid-input' || reason === 'quantity-exceeds-purchased') return 400;
  if (reason === 'not-delivered' || reason === 'no-capture') return 409;
  return 503;
}

/** The return queue, optionally filtered to one status. */
export async function GET(request: Request) {
  const guard = await requireStoreRole('store_viewer');
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const result = await listReturns({
    status: url.searchParams.get('status') ?? undefined,
  });
  if (!result.ok) {
    return NextResponse.json({ error: 'Returns are not available.' }, { status: 503 });
  }
  return NextResponse.json(result.data, { headers: { 'Cache-Control': 'no-store' } });
}

/**
 * Open a return against a delivered order. The lines carry the quantities, the
 * condition grade and whether the goods go back on the shelf. Nothing is
 * restocked here — that happens when the return is received.
 */
export async function POST(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  let body: { txnid?: unknown; lines?: unknown; reason?: unknown; note?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const txnid = typeof body.txnid === 'string' ? body.txnid.trim() : '';
  if (!txnid) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });

  const lines = Array.isArray(body.lines) ? (body.lines as ReturnLineInput[]) : [];

  const result = await createReturn({
    txnid,
    lines,
    reason: body.reason,
    note: body.note,
    actorId: guard.session.adminId,
  });

  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'return.create',
      entity: 'order',
      entityId: txnid,
      status: 'denied',
      reason: result.reason,
      after: { lines: lines.length },
      request,
    });
    return NextResponse.json({ error: result.error }, { status: statusForFailure(result.reason) });
  }

  // The free-text reason can name the customer, so the audit keeps only counts.
  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'return.create',
    entity: 'return',
    entityId: result.id,
    reason: 'rma_opened',
    after: {
      txnid,
      status: result.status,
      lines: lines.length,
      quantity: lines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0),
    },
    request,
  });

  return NextResponse.json({ id: result.id, status: result.status }, { status: 201 });
}
