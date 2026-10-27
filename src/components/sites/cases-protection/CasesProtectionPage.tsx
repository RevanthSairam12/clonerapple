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
  saleLive = false,
}: {
  config: CollectionConfig;
  products: CollectionProduct[];
  overrides?: CasesProtectionOverrides;
  /** The sale switch on the database clock; a live sale never disables a card. */
  saleLive?: boolean;
}) {
  return (
    <CollectionPage
      config={config}
      products={products}
      overrides={overrides}
      saleLive={saleLive}
    />
  );
}