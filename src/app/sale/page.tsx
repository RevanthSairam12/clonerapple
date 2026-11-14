import { Suspense } from 'react';
import type { Metadata } from 'next';

import { CollectionPage } from '@/components/collection/CollectionPage';
import type { CollectionConfig } from '@/components/collection/types';
import type { GadzioSaleBannerProps } from '@/components/banner/GadzioSaleBanner';
import { getContent } from '@/lib/content';
import { readStorefrontCatalog } from '@/lib/catalog/storefront';
import { siteOpenGraphUrl } from '@/lib/storefront/metadata';
import { selectSalePageProducts } from '@/lib/storefront/sale-page';
import { readSaleState } from '@/lib/storefront/sale-state';
import { readTrustBarContent } from '@/lib/website/trust-bar';

import '@/components/sites/accessories/accessory-category.css';

/** Sale pricing and availability must reflect live DB state per request. */
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  const url = siteOpenGraphUrl('/sale');
  return {
    title: 'Sale | Gadzio Store',
    description: 'Shop limited-time sale pricing and discounted offers on select Gadzio cases, chargers, audio gear, and everyday tech accessories.',
    openGraph: {
      title: 'Sale | Gadzio Store',
      description: 'Shop limited-time sale pricing and discounted offers on select Gadzio essentials.',
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
  const [snapshot, sale, saleBanner, trustBar] = await Promise.all([
    readStorefrontCatalog().catch(() => null),
    readSaleState(),
    getContent<GadzioSaleBannerProps>('gadzio.sale_banner', {}),
    readTrustBarContent(),
  ]);

  const saleProducts = selectSalePageProducts(snapshot?.products ?? [], sale.live);

  const subhead =
    saleProducts.length === 0
      ? 'No ongoing sale or discounted items right now. Check back soon or explore our latest accessories.'
      : sale.live
        ? 'Limited-time sale pricing and discounted offers on select Gadzio essentials.'
        : 'Discounted offers and special pricing on select Gadzio essentials.';

  const config: CollectionConfig = {
    slug: 'sale',
    title: 'Sale',
    subhead,
    breadcrumbLeaf: 'Sale',
    countNoun: 'sale items',
    categoryLinks: [
      { label: 'Sale', href: '/sale', active: true },
      { label: 'Cases & Protection', href: '/in/shop/iphone/accessories/cases-protection' },
      { label: 'Mobile Cases', href: '/in/shop/iphone/accessories/mobile-cases' },
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
        saleBanner={saleBanner}
        trustBar={trustBar}
        catalogEmptyState={{
          title: 'No active sale items right now',
          description:
            'There are no ongoing sale offers or discounted products at the moment. Explore our latest cases, chargers, and audio gear.',
          ctaLabel: 'Browse Cases & Accessories',
          ctaHref: '/in/shop/iphone/accessories/cases-protection',
        }}
      />
    </Suspense>
  );
}
