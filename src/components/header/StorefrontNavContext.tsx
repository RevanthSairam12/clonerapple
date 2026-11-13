'use client';

import React, { createContext, useContext } from 'react';
import type { NavLabelsOverride } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/admin-overrides';

const StorefrontNavContext = createContext<NavLabelsOverride | undefined>(undefined);

export function StorefrontNavProvider({
  navOverride,
  children,
}: {
  navOverride?: NavLabelsOverride;
  children: React.ReactNode;
}) {
  return (
    <StorefrontNavContext.Provider value={navOverride}>
      {children}
    </StorefrontNavContext.Provider>
  );
}

export function useStorefrontNav(): NavLabelsOverride | undefined {
  return useContext(StorefrontNavContext);
}

