import { revalidatePath, revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/platform/api-guard';
import { writeAudit } from '@/lib/store-admin/audit';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { catalogFailureStatus } from '@/lib/store-admin/catalog-writes';
import {
  addCollectionProduct,
  listCollectionProductOptions,
  listStoreCollections,
  removeCollectionProduct,
  reorderCollection,
} from '@/lib/store-admin/collections';
import {
  validateMembershipInput,
  validateProductId,
  validateCollectionKey,
  validateReorderInput,
} from '@/lib/store-admin/collection-rules';
import { COLLECTION_CACHE_TAG } from '@/lib/storefront/collections-rules';

/**
 * Store-admin collection membership.
 *
 * A collection is a named, ordered list of products used by a storefront rail
 * (for example a homepage carousel). Merchandising lives here, not in the
 * legacy content editor. Every mutation is audited, same-origin checked and
 * invalidates the storefront collection cache so the next request is fresh.
 */
export const dynamic = 'force-dynamic';

/** Collection membership is merchandising, so `store_admin` may edit it. */
const WRITE_ROLE = 'store_admin' as const;

function revalidateStorefrontCollections(): void {
  revalidateTag(COLLECTION_CACHE_TAG, { expire: 0 });
  revalidatePath('/', 'layout');
}

export async function GET() {
  const guard = await requireStoreRole();
  if (!guard.ok) return guard.response;

  const [collections, options] = await Promise.all([
    listStoreCollections(),
    listCollectionProductOptions(),
  ]);
  if (!collections.ok) {
    return NextResponse.json({ error: collections.error }, { status: 503 });
  }
  if (!options.ok) {
    return NextResponse.json({ error: options.error }, { status: 503 });
  }

  return NextResponse.json({
    collections: collections.data,
    products: options.data,
  });
}

export async function POST(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole(WRITE_ROLE);
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const validation = validateMembershipInput(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  const { collectionKey, productId } = validation.value;

  const result = await addCollectionProduct(collectionKey, productId);
  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'catalog.collection.add',
      entity: 'product_collection',
      entityId: `${collectionKey}:${productId}`,
      status: 'denied',
      reason: result.reason,
      after: { collection_key: collectionKey, product_id: productId },
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
    action: 'catalog.collection.add',
    entity: 'product_collection',
    entityId: `${collectionKey}:${productId}`,
    before: { products: result.data.before.map((row) => row.productId) },
    after: { products: result.data.after.map((row) => row.productId) },
    reason: 'collection_membership_added',
    request,
  });

  revalidateStorefrontCollections();
  return NextResponse.json({ ok: true, collection: result.data.after }, { status: 201 });
}

export async function PUT(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole(WRITE_ROLE);
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const validation = validateReorderInput(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  const { collectionKey, productIds } = validation.value;

  const result = await reorderCollection(collectionKey, productIds);
  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'catalog.collection.reorder',
      entity: 'product_collection',
      entityId: collectionKey,
      status: 'denied',
      reason: result.reason,
      after: { products: productIds },
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
    action: 'catalog.collection.reorder',
    entity: 'product_collection',
    entityId: collectionKey,
    before: { products: result.data.before.map((row) => row.productId) },
    after: { products: result.data.after.map((row) => row.productId) },
    reason: 'collection_reordered',
    request,
  });

  revalidateStorefrontCollections();
  return NextResponse.json({ ok: true, collection: result.data.after });
}

export async function DELETE(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole(WRITE_ROLE);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const key = validateCollectionKey(url.searchParams.get('collectionKey'));
  if (!key.ok) {
    return NextResponse.json({ error: key.error }, { status: 400 });
  }
  const product = validateProductId(url.searchParams.get('productId'));
  if (!product.ok) {
    return NextResponse.json({ error: product.error }, { status: 400 });
  }

  const result = await removeCollectionProduct(key.value, product.value);
  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'catalog.collection.remove',
      entity: 'product_collection',
      entityId: `${key.value}:${product.value}`,
      status: 'denied',
      reason: result.reason,
      before: { collection_key: key.value, product_id: product.value },
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
    action: 'catalog.collection.remove',
    entity: 'product_collection',
    entityId: `${key.value}:${product.value}`,
    before: { products: result.data.before.map((row) => row.productId) },
    after: { products: result.data.after.map((row) => row.productId) },
    reason: 'collection_membership_archived',
    request,
  });

  revalidateStorefrontCollections();
  return NextResponse.json({ ok: true, collection: result.data.after });
}
