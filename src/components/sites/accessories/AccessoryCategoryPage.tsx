'use client';

import React from 'react';
import { CollectionPage } from '@/components/collection/CollectionPage';
import { normalizeProduct, type CollectionConfig } from '@/components/collection/types';
import type { AccessoryProduct, CategoryConfig } from './data/types';

export interface AccessoryCategoryPageProps {
  config: CategoryConfig;
  products: AccessoryProduct[];
  /** The sale switch on the database clock; a live sale never disables a card. */
  saleLive?: boolean;
}

export function AccessoryCategoryPage({ config, products, saleLive = false }: AccessoryCategoryPageProps) {
  const normalized = products.map(normalizeProduct);

  return (
    <CollectionPage
      config={config as CollectionConfig}
      products={normalized}
      saleLive={saleLive}
    />
  );
}
