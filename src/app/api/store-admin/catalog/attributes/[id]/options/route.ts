import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { validateAttributeOption } from '@/lib/store-admin/catalog-rules';
import {
  addAttributeOption,
  catalogFailureStatus,
  removeAttributeOption,
} from '@/lib/store-admin/catalog-writes';

/**
 * Options of an `enum` attribute.
 *
 * POST   { value, sortOrder? }  add an option
 * DELETE ?value=...             remove an option no product uses
 */
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Params) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_owner');
  if (!guard.ok) return guard.response;

  let body: { value?: unknown; sortOrder?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const validation = validateAttributeOption(body.value);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const sortOrder = body.sortOrder === undefined ? 0 : Number(body.sortOrder);
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 10000) {
    return NextResponse.json(
      { error: 'Sort order must be a whole number between 0 and 10000.' },
      { status: 400 },
    );
  }

  const { id } = await context.params;
  const result = await addAttributeOption(id, validation.value, sortOrder);

  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'catalog.attribute.option.add',
      entity: 'attribute_option',
      entityId: `${id}:${validation.value}`,
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
    action: 'catalog.attribute.option.add',
    entity: 'attribute_option',
    entityId: `${id}:${validation.value}`,
    after: result.data,
    reason: 'attribute_option_added',
    request,
  });

  return NextResponse.json({ ok: true, option: result.data }, { status: 201 });
}

export async function DELETE(request: Request, context: Params) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_owner');
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const validation = validateAttributeOption(url.searchParams.get('value'));
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const { id } = await context.params;
  const result = await removeAttributeOption(id, validation.value);

  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'catalog.attribute.option.remove',
      entity: 'attribute_option',
      entityId: `${id}:${validation.value}`,
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
    action: 'catalog.attribute.option.remove',
    entity: 'attribute_option',
    entityId: `${id}:${validation.value}`,
    reason: 'attribute_option_removed',
    request,
  });

  return NextResponse.json({ ok: true });
}
