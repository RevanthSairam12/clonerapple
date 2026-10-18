'use client';

import React from 'react';
import { CollectionPage } from '@/components/collection/CollectionPage';
import { normalizeProduct, type CollectionConfig } from '@/components/collection/types';
import { buildCategoryLinks } from '@/components/sites/accessories/data/types';
import { PRODUCTS } from './data/products';
import type {
  CasesCategoryLinkOverride,
  CasesPageHeaderOverride,
  CasesProductOverride,
} from './admin-overrides';

export interface CasesProtectionOverrides {
  categoryLinks?: CasesCategoryLinkOverride[];
  header?: CasesPageHeaderOverride;
  products?: CasesProductOverride[];
}

const CASES_CONFIG: CollectionConfig = {
  slug: 'cases-protection',
  title: 'iPhone Cases & Protection',
  subhead:
    'Explore premium Gadzio protective cases for iPhone with military-grade drop defense, liquid silicone, anti-yellowing crystal clear, and MagSafe compatibility.',
  breadcrumbLeaf: 'Cases & Protection',
  countNoun: 'cases',
  categoryLinks: buildCategoryLinks('cases-protection'),
  filters: [
    {
      id: 'model',
      label: 'Compatible With',
      options: ['iPhone 18 Pro Max', 'iPhone 18 Pro', 'iPhone 17'],
    },
    {
      id: 'material',
      label: 'Material',
      options: ['Liquid Silicone', 'Crystal Clear'],
    },
    {
      id: 'brand',
      label: 'Brand',
      options: ['Gadzio Signature', 'Gadzio Pro'],
    },
  ],
  quickPillFacet: 'model',
  quickPills: ['iPhone 18 Pro Max', 'iPhone 18 Pro', 'iPhone 17'],
  disclaimer:
    'iPhone, MagSafe, and Apple are trademarks of Apple Inc. Gadzio cases and accessories are independently engineered for device compatibility and are not affiliated with, sponsored by, or endorsed by Apple Inc.',
};

function mergeProducts(overrides: CasesProductOverride[] | undefined) {
  if (!overrides) return PRODUCTS;
  return overrides.map((o, i) => {
    const product = PRODUCTS[i] ?? PRODUCTS[PRODUCTS.length - 1];
    const rawPrice = o.price;
    const parsedPrice =
      rawPrice === undefined || rawPrice === null || (rawPrice as unknown) === ''
        ? product.price
        : Number(rawPrice);
    return {
      ...product,
      name: o.name ?? product.name,
      subtitle: o.subtitle ?? product.subtitle,
      price: Number.isFinite(parsedPrice) ? parsedPrice : product.price,
      priceDisplay: o.priceDisplay ?? product.priceDisplay,
      image: o.image ?? product.image,
      href: o.href ?? product.href,
    };
  });
}

export function CasesProtectionPage({ overrides }: { overrides?: CasesProtectionOverrides } = {}) {
  const merged = mergeProducts(overrides?.products);
  const normalized = merged.map(normalizeProduct);

  return (
    <CollectionPage
      config={CASES_CONFIG}
      products={normalized}
      overrides={overrides}
    />
  );
}
