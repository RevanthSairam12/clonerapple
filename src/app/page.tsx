import type { Metadata } from 'next';

import { AppleHomePage } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/AppleHomePage';

const DESCRIPTION =
  'Discover the innovative world of Apple and shop everything iPhone, iPad, Apple Watch, Mac, and Apple TV, plus explore accessories, entertainment, and expert device support.';

export const metadata: Metadata = {
  metadataBase: new URL('http://localhost:3000'),
  title: 'Apple',
  description: DESCRIPTION,
  openGraph: {
    title: 'Apple',
    description: DESCRIPTION,
    url: 'https://www.apple.com/',
    siteName: 'Apple',
    locale: 'en_US',
    type: 'website',
    images: ['/sites/www-apple-com-736d3707/root-8a5edab2/seo/open_graph_logo.png'],
  },
  icons: {
    icon: '/sites/www-apple-com-736d3707/root-8a5edab2/seo/favicon.ico',
  },
};

export default function Home() {
  return <AppleHomePage />;
}
