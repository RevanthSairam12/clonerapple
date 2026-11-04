import type { Metadata } from 'next';

import { AccessoryCategoryPage } from '@/components/sites/accessories/AccessoryCategoryPage';
import { CONFIG } from '@/components/sites/accessories/data/airpods-case';
import { getAccessoryProductsView } from '@/lib/storefront/catalog';
import { readSaleState } from '@/lib/storefront/sale-state';

import '@/components/sites/accessories/accessory-category.css';

/** Product records come from the database; page furniture stays coded. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: CONFIG.seo.title,
  description: CONFIG.seo.description,
  openGraph: {
    title: CONFIG.seo.title,
    description: CONFIG.seo.description,
    url: 'https://gadzio.in/in/shop/iphone/accessories/airpods-case',
    siteName: 'Gadzio',
    locale: 'en_IN',
    type: 'website',
  },
  icons: {
    icon: '/gadzio_logo.png',
  },
};

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
