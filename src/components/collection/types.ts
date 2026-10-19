// Shared types and adapter helpers for the Gadzio Collection Storefront.
// Powers all 6 collection pages with one shared component architecture.

import type { ColorSwatch, ProductHighlight, SpecRow } from '@/components/sites/accessories/data/types';
import type { Product as CaseProduct } from '@/components/sites/cases-protection/data/products';
import type { AccessoryProduct } from '@/components/sites/accessories/data/types';

export interface CollectionLink {
  label: string;
  href: string;
  active?: boolean;
}

export interface CollectionFacetDef {
  id: string;
  label: string;
  options: string[];
}

export interface CollectionConfig {
  slug: string;
  title: string;
  subhead: string;
  breadcrumbLeaf: string;
  countNoun: string;
  categoryLinks: CollectionLink[];
  filters: CollectionFacetDef[];
  quickPillFacet?: string;
  quickPills?: string[];
  disclaimer?: string;
  seo?: {
    title: string;
    description: string;
  };
}

export interface CollectionProduct {
  id: string;
  name: string;
  subtitle: string;
  price: number;
  priceDisplay: string;
  /** True when the source item has no real price, so the card shows "Unavailable". */
  priceUnavailable?: boolean;
  image: string;
  hoverImage?: string;
  images: string[];
  colors: ColorSwatch[];
  compatibility: string[];
  material: string;
  brand: string;
  category?: string;
  categorySlug?: string;
  facets: Record<string, string>;
  features: string[];
  description: string;
  highlights?: ProductHighlight[];
  specs?: SpecRow[] | Record<string, string>;
  inTheBox?: string[];
  badge?: string;
  isNew?: boolean;
  inStock?: boolean;
  href: string;
}

/**
 * Normalizes either an AccessoryProduct or a CaseProduct into a unified CollectionProduct.
 */
export function normalizeProduct(raw: AccessoryProduct | CaseProduct): CollectionProduct {
  // If it's a CaseProduct
  if ('specs' in raw && 'dropProtection' in (raw.specs as any)) {
    const cp = raw as CaseProduct;
    const hover = cp.hoverImage || undefined;
    return {
      id: cp.id,
      name: cp.name,
      subtitle: cp.subtitle || '',
      price: cp.price,
      priceDisplay: cp.priceDisplay,
      image: cp.image,
      hoverImage: hover,
      images: hover ? [cp.image, hover] : [cp.image],
      colors: cp.colors || [],
      compatibility: cp.compatibility || [],
      material: cp.material || '',
      brand: cp.brand || 'Gadzio',
      category: 'Cases & Protection',
      categorySlug: 'cases-protection',
      facets: {
        model: cp.compatibility ? cp.compatibility.join(', ') : '',
        material: cp.material || '',
        brand: cp.brand || '',
      },
      features: cp.features || [],
      description: cp.description || '',
      highlights: cp.highlights || [],
      specs: cp.specs as any,
      inTheBox: cp.inTheBox || [],
      badge: cp.badge,
      isNew: cp.badge === 'New',
      inStock: true,
      href: cp.href || `/shop/product/${cp.id}`,
    };
  }

  // Otherwise it's an AccessoryProduct
  const ap = raw as AccessoryProduct;
  const hover = ap.images && ap.images.length > 1 ? ap.images[1] : undefined;
  return {
    id: ap.id,
    name: ap.name,
    subtitle: ap.subtitle || '',
    price: ap.price,
    priceDisplay: ap.priceDisplay,
    image: ap.image,
    hoverImage: hover,
    images: ap.images || [ap.image],
    colors: ap.colors || [],
    compatibility: ap.compatibility || [],
    material: ap.material || '',
    brand: ap.brand || 'Gadzio',
    category: ap.category,
    categorySlug: ap.categorySlug,
    facets: ap.facets || {},
    features: ap.features || [],
    description: ap.description || '',
    highlights: ap.highlights || [],
    specs: ap.specs || [],
    inTheBox: ap.inTheBox || [],
    badge: (ap as any).badge,
    isNew: (ap as any).isNew || (ap as any).badge === 'New',
    inStock: (ap as any).inStock !== false,
    href: ap.href || `/shop/product/${ap.id}`,
  };
}
