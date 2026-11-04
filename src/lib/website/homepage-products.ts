import type { StorefrontProduct } from '@/lib/catalog/storefront';

const COUNTS: Record<string, number> = {
  'gadzio.diwali_campaign': 4,
  'gadzio.crowd_favorites': 6,
};

export function homepageSlotCount(key: string): number {
  return COUNTS[key] ?? 0;
}

function decorations(key: string): string[] {
  return key === 'gadzio.diwali_campaign'
    ? ['tagPrimary', 'tagSecondary']
    : ['badge', 'badgeColor', 'secondaryBadge', 'secondaryBadgeColor'];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

export function normalizeHomepageSlots(key: string, value: unknown): Record<string, unknown> {
  const source = record(value);
  const count = homepageSlotCount(key);
  if (!count) return source;
  const items = Array.isArray(source.items) ? source.items : [];
  return { ...source, items: Array.from({ length: count }, (_, index) => {
    const item = record(items[index]);
    const match = typeof item.href === 'string'
      ? /^\/shop\/(?:product|buy)\/([^/?#]+)(?:[?#].*)?$/.exec(item.href) : null;
    const slot: Record<string, string> = {
      productId: typeof item.productId === 'string' ? item.productId : match?.[1] ?? '',
    };
    for (const field of decorations(key)) {
      if (typeof item[field] === 'string') slot[field] = item[field];
    }
    return slot;
  }) };
}

/** Shape validation is shared with the boundary; catalog existence is checked on save. */
export function validateHomepageSlots(key: string, value: unknown): string | null {
  const count = homepageSlotCount(key);
  if (!count) return null;
  const items = record(value).items;
  if (!Array.isArray(items) || items.length !== count) return `Select exactly ${count} products.`;
  const seen = new Set<string>();
  const allowed = new Set(['productId', ...decorations(key)]);
  for (const entry of items) {
    const item = record(entry);
    if (Object.keys(item).some(field => !allowed.has(field))) return 'Product slots may contain only a catalog selection and promotional badges.';
    if (typeof item.productId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/.test(item.productId)) return 'Select a product for every position.';
    if (seen.has(item.productId.toLowerCase())) return 'Select a different product for each position.';
    seen.add(item.productId.toLowerCase());
    for (const field of decorations(key)) {
      if (item[field] !== undefined && (typeof item[field] !== 'string' || item[field].length > 200)) return 'Promotional badges must be text of at most 200 characters.';
    }
  }
  return null;
}

/** Preserve legacy artwork until the section is configured; never mix it with saved references. */
export function resolveHomepageSlots(key: string, value: unknown, products: StorefrontProduct[]): Record<string, unknown> {
  const source = record(value);
  const count = homepageSlotCount(key);
  const entries = Array.isArray(source.items) ? source.items : [];
  if (!count || !entries.some(item => Object.hasOwn(record(item), 'productId'))) return source;
  const normalized = normalizeHomepageSlots(key, source);
  const byId = new Map(products.map(product => [product.id.toLowerCase(), product]));
  const items = (normalized.items as Record<string, unknown>[]).map(slot => {
    const product = byId.get(String(slot.productId).toLowerCase());
    if (!product) return {
      title: 'Product unavailable', image: '', href: '', unavailable: true,
      ...(key === 'gadzio.diwali_campaign' ? { amountText: 'Currently unavailable' } : { priceDisplay: 'Currently unavailable' }),
    };
    const badges = Object.fromEntries(decorations(key).map(field => [field, slot[field]]));
    const shared = { ...badges, title: product.name, image: product.image, href: product.href };
    if (key === 'gadzio.crowd_favorites') return {
      ...shared, priceDisplay: product.priceDisplay,
      colorDots: product.colors.map(color => color.hex).join(','),
    };
    const comparison = product.onSale ? product.regularPricePaise : product.compareAtPaise;
    const saving = comparison && comparison > product.pricePaise
      ? Math.floor((comparison - product.pricePaise) * 100 / comparison) : 0;
    return {
      ...shared, amountText: product.priceDisplay,
      originalAmountText: saving ? `₹${(comparison! / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : undefined,
      savingsText: saving ? `SAVE ${saving}%` : undefined,
    };
  });
  return { ...source, items };
}
