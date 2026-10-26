import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import { listCategoryTree, upsertCategory } from '@/lib/store-admin/catalog-crud';
import { validateCategoryInput } from '@/lib/store-admin/catalog-crud-rules';
import { catalogFailureStatus } from '@/lib/store-admin/catalog-writes';

/** Category tree: list for any store role, edits for the owner only. */
export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireStoreRole();
  if (!guard.ok) return guard.response;

  const result = await listCategoryTree();
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 503 });
  }
  return NextResponse.json({ categories: result.data });
}

export async function POST(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_owner');
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const validation = validateCategoryInput(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const result = await upsertCategory(validation.value, guard.session.adminId);
  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'catalog.category.save',
      entity: 'category',
      entityId: validation.value.id ?? validation.value.slug,
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
    action: 'catalog.category.save',
    entity: 'category',
    entityId: validation.value.id ?? validation.value.slug,
    before: result.data.before,
    after: result.data.after,
    reason: result.data.created ? 'category_created' : 'category_updated',
    request,
  });

  return NextResponse.json(
    { ok: true, created: result.data.created, category: result.data.after },
    { status: result.data.created ? 201 : 200 },
  );
}
