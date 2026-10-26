/**
 * Pure validation for store-admin collection membership.
 *
 * Kept free of database/React imports so tests can exercise it directly. The
 * SQL layer assumes the values here have already been normalised.
 */

import { isValidCollectionKey, normaliseCollectionKey } from '@/lib/storefront/collections-rules';

export const MAX_COLLECTION_PRODUCTS = 200;
export const MAX_COLLECTION_KEY_LENGTH = 64;

export type CollectionFieldResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export interface CollectionMembershipInput {
  collectionKey: string;
  productId: string;
}

export interface CollectionReorderInput {
  collectionKey: string;
  productIds: string[];
}

export function validateCollectionKey(
  input: unknown,
): CollectionFieldResult<string> {
  const key = normaliseCollectionKey(input);
  if (!key) return { ok: false, error: 'A collection key is required.' };
  if (key.length > MAX_COLLECTION_KEY_LENGTH || !isValidCollectionKey(key)) {
    return {
      ok: false,
      error:
        'Use a collection key of up to 64 characters: lowercase letters, digits, dots, hyphens or underscores, starting with a letter or digit.',
    };
  }
  return { ok: true, value: key };
}

export function validateProductId(input: unknown): CollectionFieldResult<string> {
  const id = typeof input === 'string' ? input.trim() : '';
  if (!id) return { ok: false, error: 'A product is required.' };
  if (id.length > 160 || !/^[A-Za-z0-9._:-]+$/.test(id)) {
    return { ok: false, error: 'That product id is not valid.' };
  }
  return { ok: true, value: id };
}

export function validateMembershipInput(
  input: unknown,
): CollectionFieldResult<CollectionMembershipInput> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Send a collection key and a product id.' };
  }
  const body = input as Record<string, unknown>;
  const key = validateCollectionKey(body.collectionKey ?? body.collection_key);
  if (!key.ok) return key;
  const product = validateProductId(body.productId ?? body.product_id);
  if (!product.ok) return product;
  return { ok: true, value: { collectionKey: key.value, productId: product.value } };
}

/**
 * Validate a full ordered membership list. The list is the source of truth for
 * the collection: ids omitted from it are archived (is_active = false), so the
 * caller must send every product it wants to keep.
 */
export function validateReorderInput(
  input: unknown,
): CollectionFieldResult<CollectionReorderInput> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Send a collection key and an ordered product list.' };
  }
  const body = input as Record<string, unknown>;
  const key = validateCollectionKey(body.collectionKey ?? body.collection_key);
  if (!key.ok) return key;

  const raw = body.productIds ?? body.product_ids;
  if (!Array.isArray(raw)) {
    return { ok: false, error: 'The product list must be an array.' };
  }
  if (raw.length > MAX_COLLECTION_PRODUCTS) {
    return {
      ok: false,
      error: `A collection holds at most ${MAX_COLLECTION_PRODUCTS} products.`,
    };
  }

  const seen = new Set<string>();
  const productIds: string[] = [];
  for (const entry of raw) {
    const product = validateProductId(entry);
    if (!product.ok) return product;
    if (seen.has(product.value)) {
      return { ok: false, error: `Product ${product.value} appears twice.` };
    }
    seen.add(product.value);
    productIds.push(product.value);
  }

  return { ok: true, value: { collectionKey: key.value, productIds } };
}
