import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { deleteExpense, updateExpense } from '@/lib/store-admin/expenses';

/**
 * One expense entry.
 *
 * PATCH replaces the editable fields (the ledger has no partial-update UI) and
 * DELETE is a soft delete, so the audit row keeps pointing at a real record.
 * Both are store_admin and above.
 */

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Props) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const { id } = await params;
  const result = await updateExpense(
    id,
    {
      title: body.title,
      amount: body.amount,
      spentOn: body.spentOn,
      categoryId: body.categoryId,
      note: body.note,
      attachmentMediaId: body.attachmentMediaId,
    },
    guard.session.adminId,
  );

  if (!result.ok) {
    if (result.reason === 'not-found') {
      return NextResponse.json({ error: 'That expense no longer exists.' }, { status: 404 });
    }
    if (result.reason === 'invalid-input') {
      return NextResponse.json(
        { error: 'Check the title, amount, date and category.' },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: 'The expense could not be saved.' }, { status: 503 });
  }

  const { before, after } = result.data;
  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'expense.update',
    entity: 'expense',
    entityId: after.id,
    before: {
      title: before.title,
      amountPaise: before.amountPaise,
      spentOn: before.spentOn,
      categoryId: before.categoryId,
    },
    after: {
      title: after.title,
      amountPaise: after.amountPaise,
      spentOn: after.spentOn,
      categoryId: after.categoryId,
    },
    reason: 'manual_correction',
    request,
  });

  return NextResponse.json({ expense: after });
}

export async function DELETE(request: Request, { params }: Props) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const result = await deleteExpense(id, guard.session.adminId);

  if (!result.ok) {
    if (result.reason === 'not-found') {
      return NextResponse.json({ error: 'That expense no longer exists.' }, { status: 404 });
    }
    return NextResponse.json({ error: 'The expense could not be removed.' }, { status: 503 });
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'expense.delete',
    entity: 'expense',
    entityId: result.data.id,
    before: {
      title: result.data.title,
      amountPaise: result.data.amountPaise,
      spentOn: result.data.spentOn,
      categoryId: result.data.categoryId,
    },
    reason: 'soft_delete',
    request,
  });

  return NextResponse.json({ ok: true });
}
