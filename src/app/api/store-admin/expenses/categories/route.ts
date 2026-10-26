import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { createExpenseCategory, listExpenseCategories } from '@/lib/store-admin/expenses';

/** Expense categories: seeded reference rows plus any the owner adds. */

export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireStoreRole('store_viewer');
  if (!guard.ok) return guard.response;

  const result = await listExpenseCategories();
  if (!result.ok) {
    return NextResponse.json({ error: 'Expense categories are not available.' }, { status: 503 });
  }

  return NextResponse.json(
    { categories: result.data },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  let body: { name?: unknown };
  try {
    body = (await request.json()) as { name?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const result = await createExpenseCategory(body.name, guard.session.adminId);
  if (!result.ok) {
    if (result.reason === 'invalid-input') {
      return NextResponse.json({ error: 'Enter a category name.' }, { status: 400 });
    }
    if (result.reason === 'conflict') {
      return NextResponse.json({ error: 'That category already exists.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'The category could not be saved.' }, { status: 503 });
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'expense.category.create',
    entity: 'expense_category',
    entityId: result.data.id,
    after: { name: result.data.name },
    reason: 'ledger_setup',
    request,
  });

  return NextResponse.json({ category: result.data }, { status: 201 });
}
