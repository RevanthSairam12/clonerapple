import type { TransactionSql } from 'postgres';

import { VariantIdentityError } from './variant-identity';

type Row = Record<string, unknown>;

/**
 * Attach the shared colour an option row sells.
 *
 * `product_variant_colours` is append-only: a database trigger rejects UPDATE
 * and DELETE, and `variant_id` is the primary key. So this only ever inserts a
 * first link. Omitted or empty input leaves the saved link untouched; asking
 * for a different colour is a conflict, because the only supported correction
 * is to archive the option and create a replacement.
 *
 * Colour identity is a reference to a `colours` row and nothing else — it is
 * never derived from the option label or its hex.
 */
export async function saveVariantColourUsing(
  tx: TransactionSql,
  productId: string,
  variantId: string,
  colourId: string | null | undefined,
): Promise<string | null> {
  // Omitted, null and empty all mean "no link to add". An existing link is
  // never removed here because the relationship is append-only.
  if (colourId === undefined || colourId === null || colourId === '') return null;
  const existing = (await tx`
    select colour_id from product_variant_colours
    where variant_id = ${variantId} and product_id = ${productId}
  `) as Row[];
  if (existing.length) {
    if (String(existing[0].colour_id) === colourId) return colourId;
    throw new VariantIdentityError(
      'A saved option colour cannot be changed. Archive the option and create a replacement instead.',
      409,
    );
  }
  const colours = (await tx`
    select id from colours where id = ${colourId} and is_active
  `) as Row[];
  if (!colours.length) throw new VariantIdentityError('Select an active shared colour.', 400);
  await tx`
    insert into product_variant_colours (variant_id, product_id, colour_id)
    values (${variantId}, ${productId}, ${colourId})
  `;
  return colourId;
}
