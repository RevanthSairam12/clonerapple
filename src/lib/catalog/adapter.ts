/**
 * Adapters from the live database catalogue to the prop shapes the storefront
 * components already render. Pure mapping only — no queries, no fallbacks.
 */

import type {
  AccessoryProduct,
  CategoryConfig,
} from '@/components/sites/accessories/data/types';
import { buildCategoryLinks } from '@/components/sites/accessories/data/types';
import type { CollectionProduct } from '@/components/collection/types';

import { productHref, type StorefrontCategory, type StorefrontProduct } from './storefront';

/** Grid-card shape used by the shared collection page. */
export function toCollectionProduct(product: StorefrontProduct): CollectionProduct {
  return {
    id: product.id,
    name: product.name,
    subtitle: product.subtitle,
    price: product.price,
    priceDisplay: product.priceDisplay,
    image: product.image,
    hoverImage: product.hoverImage,
    images: product.gallery.length > 0 ? product.gallery : [product.image].filter(Boolean),
    colors: product.colors,
    compatibility: product.compatibility,
    material: product.material,
    brand: product.brand,
    category: product.categoryName,
    categorySlug: product.categorySlug,
    facets: product.facets,
    features: product.features,
    description: product.description,
    highlights: product.highlights,
    specs: product.specs,
    inTheBox: product.inTheBox,
    badge: product.badge,
    isNew: product.badge === 'New',
    inStock: product.inStock,
    href: product.href,
  };
}

export function toAccessoryProduct(product: StorefrontProduct): AccessoryProduct {
  return {
    id: product.id,
    name: product.name,
    subtitle: product.subtitle,
    price: product.price,
    priceDisplay: product.priceDisplay,
    image: product.image,
    images: product.gallery.length > 0 ? product.gallery : [product.image].filter(Boolean),
    colors: product.colors,
    compatibility: product.compatibility,
    material: product.material,
    brand: product.brand,
    category: product.categoryName,
    categorySlug: product.categorySlug,
    facets: product.facets,
    features: product.features,
    description: product.description,
    highlights: product.highlights,
    specs: product.specs,
    inTheBox: product.inTheBox,
    href: product.href,
  };
}

export function toCategoryConfig(category: StorefrontCategory): CategoryConfig {
  const quickPill = category.facets.find((facet) => facet.isQuickPill);
  return {
    slug: category.slug,
    title: category.title,
    subhead: category.subhead,
    breadcrumbLeaf: category.breadcrumbLeaf,
    countNoun: category.countNoun,
    categoryLinks: buildCategoryLinks(category.slug),
    filters: category.facets.map((facet) => ({
      id: facet.id,
      label: facet.label,
      options: facet.options,
    })),
    quickPillFacet: quickPill?.id,
    quickPills: quickPill?.options,
    disclaimer: category.disclaimer,
    seo: category.seo,
  };
}

export { productHref };
