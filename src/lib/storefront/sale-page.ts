import { applySaleDisplay, formatPaise, type StorefrontProduct } from '@/lib/catalog/storefront';
import { collectionProductFromDatabase } from '@/lib/storefront/catalog-merge';
import type { CollectionProduct } from '@/components/collection/types';

/**
 * Selects products to showcase on `/sale` without altering checkout or
 * site-wide sale pricing rules:
 * - Includes items on active sale (product or purchasable variant) while `saleLive` is true.
 * - Includes evergreen discounted items where `compareAtPaise > pricePaise`.
 */
export function selectSalePageProducts(
  products: readonly StorefrontProduct[],
  saleLive: boolean,
): CollectionProduct[] {
  const results: CollectionProduct[] = [];

  for (const product of products) {
    const resolved = applySaleDisplay(product, saleLive);
    const hasLiveSale =
      saleLive &&
      (resolved.onSale ||
        (resolved.inventoryMode === 'variant' &&
          (resolved.purchasableVariants ?? []).some((variant) => variant.onSale)));
    const hasCompareDiscount =
      resolved.compareAtPaise !== null && resolved.compareAtPaise > resolved.pricePaise;

    if (!hasLiveSale && !hasCompareDiscount) continue;

    const card = collectionProductFromDatabase(resolved, null);
    if (!card.wasPriceDisplay && hasCompareDiscount && resolved.compareAtPaise) {
      // Display-only strike-through MRP for compare-at markdowns; leave `regularPrice`
      // undefined so cart price-review checks remain aligned with selling price.
      results.push({
        ...card,
        wasPriceDisplay: formatPaise(resolved.compareAtPaise),
      });
    } else {
      results.push(card);
    }
  }

  return results;
}
