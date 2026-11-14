'use client';

import React, { createContext, useContext } from 'react';
import type { TrustBadgeItem } from '@/lib/website/section-defaults';

export interface TrustBarOverrideValue {
  enabled?: boolean;
  items?: TrustBadgeItem[];
}

const StorefrontTrustBarContext = createContext<TrustBarOverrideValue | undefined>(undefined);

export function StorefrontTrustBarProvider({
  value,
  children,
}: {
  value?: TrustBarOverrideValue;
  children: React.ReactNode;
}) {
  return (
    <StorefrontTrustBarContext.Provider value={value}>
      {children}
    </StorefrontTrustBarContext.Provider>
  );
}

export function useStorefrontTrustBar(): TrustBarOverrideValue | undefined {
  return useContext(StorefrontTrustBarContext);
}
