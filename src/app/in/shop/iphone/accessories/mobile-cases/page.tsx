import type { Metadata } from 'next';

import { AccessoryCategoryPage } from '@/components/sites/accessories/AccessoryCategoryPage';
import { CONFIG } from '@/components/sites/accessories/data/mobile-cases';
import { getAccessoryProductsView } from '@/lib/storefront/catalog';

import '@/components/sites/accessories/accessory-category.css';

/** Product records come from the database; page furniture stays coded. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: CONFIG.seo.title,
  description: CONFIG.seo.description,
  openGraph: {
    title: CONFIG.seo.title,
    description: CONFIG.seo.description,
    url: 'https://gadzio.in/in/shop/iphone/accessories/mobile-cases',
    siteName: 'Gadzio',
    locale: 'en_IN',
    type: 'website',
  },
  icons: {
    icon: '/gadzio_logo.png',
  },
};

export default async function Page() {
  const { products } = await getAccessoryProductsView(CONFIG.slug);
  return <AccessoryCategoryPage config={CONFIG} products={products} />;
}
