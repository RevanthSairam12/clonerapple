'use client';

import React from 'react';
import { CollectionPage } from '@/components/collection/CollectionPage';
import { normalizeProduct, type CollectionConfig } from '@/components/collection/types';
import type { AccessoryProduct, CategoryConfig } from './data/types';

export interface AccessoryCategoryPageProps {
  config: CategoryConfig;
  products: AccessoryProduct[];
}

export function AccessoryCategoryPage({ config, products }: AccessoryCategoryPageProps) {
  const normalized = products.map(normalizeProduct);

  return (
    <CollectionPage
      config={config as CollectionConfig}
      products={normalized}
    />
  );
}
