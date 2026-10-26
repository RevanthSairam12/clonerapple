'use client';

import React from 'react';
import { CollectionPage } from '@/components/collection/CollectionPage';
import type { CollectionConfig, CollectionProduct } from '@/components/collection/types';
import type {
  CasesCategoryLinkOverride,
  CasesPageHeaderOverride,
} from './admin-overrides';

/**
 * The grid is supplied by the caller (`src/lib/catalog/storefront.ts` reads it
 * from the `products` table). Only page furniture — the header title and the
 * category link rail — can be overridden from the CMS.
 */
export interface CasesProtectionOverrides {
  categoryLinks?: CasesCategoryLinkOverride[];
  header?: CasesPageHeaderOverride;
}

export function CasesProtectionPage({
  config,
  products,
  overrides,
}: {
  config: CollectionConfig;
  products: CollectionProduct[];
  overrides?: CasesProtectionOverrides;
}) {
  return <CollectionPage config={config} products={products} overrides={overrides} />;
}