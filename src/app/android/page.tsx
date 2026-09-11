import type { Metadata } from 'next';

import { OppoHomePage } from '@/components/sites/oppo-india/OppoHomePage';

const DESCRIPTION =
  'Discover OPPO smartphones, tablets, audio accessories, and IoT products. Explore the latest Reno, Find, and F series phones with cutting-edge AI features powered by ColorOS.';

export const metadata: Metadata = {
  metadataBase: new URL('http://localhost:3000'),
  title: 'OPPO Official Site - OPPO India',
  description: DESCRIPTION,
  openGraph: {
    title: 'OPPO Official Site - OPPO India',
    description: DESCRIPTION,
    url: 'https://www.oppo.com/in/',
    siteName: 'OPPO India',
    locale: 'en_IN',
    type: 'website',
  },
};

export default function AndroidPage() {
  return <OppoHomePage />;
}
