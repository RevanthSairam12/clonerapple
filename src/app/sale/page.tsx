import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { CollectionPage } from '@/components/collection/CollectionPage';
import type { CollectionConfig } from '@/components/collection/types';
import { applySaleDisplay, readStorefrontCatalog } from '@/lib/catalog/storefront';
import { collectionProductFromDatabase } from '@/lib/storefront/catalog-merge';
import { siteOpenGraphUrl } from '@/lib/storefront/metadata';
import { readSaleState } from '@/lib/storefront/sale-state';

import '@/components/sites/accessories/accessory-category.css';

/** Sale pricing and availability must reflect live DB state per request. */
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  const url = siteOpenGraphUrl('/sale');
  return {
    title: 'Sale | Gadzio Store',
    description: 'Shop limited-time sale pricing on select Gadzio cases, chargers, audio gear, and everyday tech accessories.',
    openGraph: {
      title: 'Sale | Gadzio Store',
      description: 'Shop limited-time sale pricing on select Gadzio essentials.',
      ...(url ? { url } : {}),
      siteName: 'Gadzio',
      locale: 'en_IN',
      type: 'website',
    },
    icons: {
      icon: '/gadzio_logo.png',
    },
  };
}

export default async function SalePage() {
  const [snapshot, sale] = await Promise.all([
    readStorefrontCatalog().catch(() => null),
    readSaleState(),
  ]);

  const saleProducts = sale.live
    ? (snapshot?.products ?? [])
        .map((product) => applySaleDisplay(product, true))
        .filter(
          (product) =>
            product.onSale ||
            (product.inventoryMode === 'variant' &&
              (product.purchasableVariants ?? []).some((variant) => variant.onSale)),
        )
        .map((product) => collectionProductFromDatabase(product, null))
    : [];

  if (saleProducts.length === 0) {
    notFound();
  }

  const config: CollectionConfig = {
    slug: 'sale',
    title: 'Sale',
    subhead: 'Limited-time sale pricing on select Gadzio essentials.',
    breadcrumbLeaf: 'Sale',
    countNoun: 'sale items',
    categoryLinks: [
      { label: 'Sale', href: '/sale', active: true },
      { label: 'Cases & Protection', href: '/in/shop/iphone/accessories/cases-protection' },
      { label: 'Chargers & Cables', href: '/in/shop/iphone/accessories/power-adapter-cable' },
      { label: 'Audio', href: '/in/shop/iphone/accessories/wired-earphones' },
      { label: 'AirPods Cases', href: '/in/shop/iphone/accessories/airpods-case' },
    ],
    filters: [],
  };

  return (
    <Suspense fallback={null}>
      <CollectionPage
        config={config}
        products={saleProducts}
        saleLive={sale.live}
      />
    </Suspense>
  );
}
