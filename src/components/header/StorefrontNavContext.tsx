'use client';

import React, { createContext, useContext } from 'react';
import type { NavLabelsOverride } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/admin-overrides';
import {
  StorefrontTrustBarProvider,
  type TrustBarOverrideValue,
} from '@/components/trust/StorefrontTrustBarContext';

const StorefrontNavContext = createContext<NavLabelsOverride | undefined>(undefined);

export function StorefrontNavProvider({
  navOverride,
  trustBarOverride,
  children,
}: {
  navOverride?: NavLabelsOverride;
  trustBarOverride?: TrustBarOverrideValue;
  children: React.ReactNode;
}) {
  return (
    <StorefrontNavContext.Provider value={navOverride}>
      <StorefrontTrustBarProvider value={trustBarOverride}>
        {children}
      </StorefrontTrustBarProvider>
    </StorefrontNavContext.Provider>
  );
}

export function useStorefrontNav(): NavLabelsOverride | undefined {
  return useContext(StorefrontNavContext);
}

