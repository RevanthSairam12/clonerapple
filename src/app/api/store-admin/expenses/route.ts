import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { createExpense, listExpenses } from '@/lib/store-admin/expenses';
import { parseReportFilters } from '@/lib/store-admin/report-rules';

/**
 * Expense ledger.
 *
 * GET lists the filtered entries (any store role); POST records a new one
 * (store_admin and above). The audit row carries the ledger fields but never
 * the free-text note or the attachment URL.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const guard = await requireStoreRole('store_viewer');
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const parsed = parseReportFilters(Object.fromEntries(url.searchParams));
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const page = Number.parseInt(url.searchParams.get('page') ?? '1', 10);
  const result = await listExpenses({
    fromDay: parsed.filters.fromDay,
    toDay: parsed.filters.toDay,
    categoryId: parsed.filters.categoryId,
    page: Number.isFinite(page) ? page : 1,
  });

  if (!result.ok) {
    return NextResponse.json({ error: 'The expense ledger is not available.' }, { status: 503 });
  }

  return NextResponse.json(
    { ...result.data, fromDay: parsed.filters.fromDay, toDay: parsed.filters.toDay },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: Request) {
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

  const result = await createExpense(
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
    if (result.reason === 'invalid-input') {
      return NextResponse.json(
        { error: 'Check the title, amount, date and category.' },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: 'The expense could not be saved.' }, { status: 503 });
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'expense.create',
    entity: 'expense',
    entityId: result.data.id,
    after: {
      title: result.data.title,
      amountPaise: result.data.amountPaise,
      spentOn: result.data.spentOn,
      categoryId: result.data.categoryId,
    },
    reason: 'manual_entry',
    request,
  });

  return NextResponse.json({ expense: result.data }, { status: 201 });
}
