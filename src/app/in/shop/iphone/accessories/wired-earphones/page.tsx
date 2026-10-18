import type { Metadata } from 'next';

import { AccessoryCategoryPage } from '@/components/sites/accessories/AccessoryCategoryPage';
import { CONFIG, PRODUCTS } from '@/components/sites/accessories/data/wired-earphones';

import '@/components/sites/accessories/accessory-category.css';

export const metadata: Metadata = {
  title: CONFIG.seo.title,
  description: CONFIG.seo.description,
  openGraph: {
    title: CONFIG.seo.title,
    description: CONFIG.seo.description,
    url: 'https://gadzio.in/in/shop/iphone/accessories/wired-earphones',
    siteName: 'Gadzio',
    locale: 'en_IN',
    type: 'website',
  },
  icons: {
    icon: '/gadzio_logo.png',
  },
};

export default function Page() {
  return <AccessoryCategoryPage config={CONFIG} products={PRODUCTS} />;
}
