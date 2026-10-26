import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { updateProductPricing } from '@/lib/store-admin/catalog-crud';
import { validatePricePatch } from '@/lib/store-admin/catalog-crud-rules';
import { catalogFailureStatus } from '@/lib/store-admin/catalog-writes';

/**
 * Price editing.
 *
 * The gate in AGENTS.md held while checkout priced from the code catalogue.
 * PayU now resolves every line from `products` server-side, so the price a
 * customer pays is the row edited here. Each change appends an immutable
 * `price_history` row and an audit entry with before/after prices.
 */
export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const rawReason = (body as { reason?: unknown } | null)?.reason;
  const reason = typeof rawReason === 'string' ? rawReason.trim().slice(0, 200) : '';
  const validation = validatePricePatch(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const { id } = await context.params;
  const result = await updateProductPricing(
    id,
    validation.value,
    reason || 'manual_price_change',
    guard.session.adminId,
  );

  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'catalog.product.price',
      entity: 'product',
      entityId: id,
      status: 'denied',
      reason: result.reason,
      after: validation.value,
      request,
    });
    return NextResponse.json(
      { error: result.error },
      { status: catalogFailureStatus(result.reason) },
    );
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'catalog.product.price',
    entity: 'product',
    entityId: id,
    before: result.data.before,
    after: result.data.after,
    reason: reason || 'manual_price_change',
    request,
  });

  return NextResponse.json({ ok: true, changed: result.data.changed, price: result.data.after });
}
