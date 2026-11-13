import type { Metadata } from 'next';

import { AccessoryCategoryPage } from '@/components/sites/accessories/AccessoryCategoryPage';
import { CONFIG } from '@/components/sites/accessories/data/power-adapter-cable';
import { getAccessoryProductsView } from '@/lib/storefront/catalog';
import { siteOpenGraphUrl } from '@/lib/storefront/metadata';
import { readSaleState } from '@/lib/storefront/sale-state';

import '@/components/sites/accessories/accessory-category.css';

/** Product records come from the database; page furniture stays coded. */
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  const url = siteOpenGraphUrl('/in/shop/iphone/accessories/power-adapter-cable');
  return {
    title: CONFIG.seo.title,
    description: CONFIG.seo.description,
    openGraph: {
      title: CONFIG.seo.title,
      description: CONFIG.seo.description,
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

export default async function Page() {
  const [{ products, filters, quickPillFacet, quickPills }, sale] = await Promise.all([
    getAccessoryProductsView(CONFIG.slug),
    readSaleState(),
  ]);
  return (
    <AccessoryCategoryPage
      config={{ ...CONFIG, filters, quickPillFacet, quickPills }}
      products={products}
      saleLive={sale.live}
    />
  );
}
