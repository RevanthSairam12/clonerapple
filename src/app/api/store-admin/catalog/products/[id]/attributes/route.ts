import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import {
  catalogFailureStatus,
  clearProductAttributeValue,
  setProductAttributeValue,
} from '@/lib/store-admin/catalog-writes';

/**
 * One product's attribute values.
 *
 * PUT    { attributeId, value }  set (or replace) a value
 * DELETE ?attributeId=...        remove it
 *
 * The value's shape is checked against the attribute's declared type inside
 * the write layer, because the type lives in the database.
 */

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

function attributeIdOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 64) return null;
  return trimmed;
}

export async function PUT(request: Request, context: Params) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  let body: { attributeId?: unknown; value?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const attributeId = attributeIdOf(body.attributeId);
  if (!attributeId) {
    return NextResponse.json({ error: 'Choose an attribute.' }, { status: 400 });
  }

  const { id } = await context.params;
  const result = await setProductAttributeValue(id, attributeId, body.value);

  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'catalog.product.attribute.set',
      entity: 'product_attribute_value',
      entityId: `${id}:${attributeId}`,
      status: 'denied',
      reason: result.reason,
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
    action: 'catalog.product.attribute.set',
    entity: 'product_attribute_value',
    entityId: `${id}:${attributeId}`,
    before: result.data.before,
    after: result.data.after,
    reason: 'product_attribute_set',
    request,
  });

  return NextResponse.json({ ok: true, value: result.data.after });
}

export async function DELETE(request: Request, context: Params) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const attributeId = attributeIdOf(url.searchParams.get('attributeId'));
  if (!attributeId) {
    return NextResponse.json({ error: 'Choose an attribute.' }, { status: 400 });
  }

  const { id } = await context.params;
  const result = await clearProductAttributeValue(id, attributeId);

  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'catalog.product.attribute.clear',
      entity: 'product_attribute_value',
      entityId: `${id}:${attributeId}`,
      status: 'denied',
      reason: result.reason,
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
    action: 'catalog.product.attribute.clear',
    entity: 'product_attribute_value',
    entityId: `${id}:${attributeId}`,
    before: result.data.before,
    reason: 'product_attribute_cleared',
    request,
  });

  return NextResponse.json({ ok: true });
}
