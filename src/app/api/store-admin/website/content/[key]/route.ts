import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';

import { getContentRaw } from '@/lib/content';
import { assertSameOrigin } from '@/lib/platform/api-guard';
import { writeAudit } from '@/lib/store-admin/audit';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { validateLegacyContentWrite } from '@/lib/website/boundary';
import { getCollection } from '@/lib/website/collections';
import { getStorefrontProducts } from '@/lib/catalog/storefront';
import { homepageSlotCount, validateHomepageSlots } from '@/lib/website/homepage-products';
import { archiveContentBlock, saveContentBlock } from '@/lib/website/content-store';

export const dynamic = 'force-dynamic';

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** The storefront route(s) this collection renders on, so a save is live. */
function revalidateCollection(key: string, sitePaths: readonly string[]) {
  if (key === 'apple.nav') {
    revalidatePath('/', 'layout');
  }
  for (const sitePath of sitePaths) revalidatePath(sitePath);
}

/**
 * GET /api/store-admin/website/content/[key] — one collection's stored value
 * (null when the site is still on its coded defaults). Every role may read.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ key: string }> },
) {
  const guard = await requireStoreRole();
  if (!guard.ok) return guard.response;

  const { key } = await context.params;
  const collection = getCollection(key);
  if (!collection) return noStore({ error: 'Unknown collection key.' }, 404);

  return noStore({ key: collection.key, value: await getContentRaw(collection.key) });
}

/**
 * PUT /api/store-admin/website/content/[key] — save one collection.
 *
 * Owner only. The commerce boundary is enforced here exactly as it was in the
 * legacy panel: products, prices, stock, orders, customers and shipping are
 * refused rather than stored, with the Education Store exempt by rule.
 */
export async function PUT(
  request: Request,
  context: { params: Promise<{ key: string }> },
) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_owner');
  if (!guard.ok) return guard.response;

  const { key } = await context.params;
  const collection = getCollection(key);
  if (!collection) return noStore({ error: 'Unknown collection key.' }, 404);

  let body: { value?: unknown };
  try {
    body = await request.json();
  } catch {
    return noStore({ error: 'Invalid request body.' }, 400);
  }

  const { value } = body;
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) {
    return noStore({ error: 'Value must be an object.' }, 400);
  }

  if (homepageSlotCount(collection.key)) {
    let error = validateHomepageSlots(collection.key, value);
    if (!error) {
      const ids = ((value as Record<string, unknown>).items as { productId: string }[]).map(item => item.productId);
      const products = await getStorefrontProducts(ids);
      const activeIds = new Set(products.map(product => product.id));
      if (ids.some(id => !activeIds.has(id))) error = 'One or more selected products are unavailable. Select active catalog products and try again.';
    }
    if (error) {
      await writeAudit({
        actorId: guard.session.adminId, actorEmail: guard.session.email,
        action: 'website.content_save', entity: 'content_block', entityId: collection.key,
        status: 'denied', reason: 'invalid_product_selection', request,
      });
      return noStore({ error }, 400);
    }
  }

  const boundary = validateLegacyContentWrite(collection.key, value, true);
  if (!boundary.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'website.content_save',
      entity: 'content_block',
      entityId: collection.key,
      status: 'denied',
      reason: 'commerce_boundary',
      request,
    });
    return noStore({ error: boundary.error }, 400);
  }

  const before = await getContentRaw(collection.key);
  const record = value as Record<string, unknown>;
  const result = await saveContentBlock(collection.key, record, guard.session.name);

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'website.content_save',
    entity: 'content_block',
    entityId: collection.key,
    // Never the whole collection: the row can be large and the audit log is
    // append-only. The fact of the change and its size are what matter here.
    before: { edited: before !== null },
    after: { edited: true, bytes: JSON.stringify(record).length, top_level_keys: Object.keys(record).length },
    status: result.ok ? 'ok' : 'failed',
    reason: result.ok ? undefined : 'database_error',
    request,
  });

  if (!result.ok) return noStore({ error: result.error }, 503);

  revalidateCollection(collection.key, collection.sitePaths);
  return noStore({ ok: true, live: true });
}

/**
 * DELETE /api/store-admin/website/content/[key] — revert to coded defaults.
 *
 * Owner only, and non-destructive: the row is archived, never deleted, so a
 * mistaken reset can be undone by saving again.
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ key: string }> },
) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_owner');
  if (!guard.ok) return guard.response;

  const { key } = await context.params;
  const collection = getCollection(key);
  if (!collection) return noStore({ error: 'Unknown collection key.' }, 404);

  const result = await archiveContentBlock(collection.key, guard.session.name);

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'website.content_reset',
    entity: 'content_block',
    entityId: collection.key,
    before: { edited: result.ok ? result.data : null },
    after: { edited: false, archived: true },
    status: result.ok ? 'ok' : 'failed',
    reason: result.ok ? undefined : 'database_error',
    request,
  });

  if (!result.ok) return noStore({ error: result.error }, 503);

  revalidateCollection(collection.key, collection.sitePaths);
  return noStore({ ok: true, archived: true });
}
