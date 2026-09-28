import type { Metadata } from 'next';

import { OppoHomePage } from '@/components/sites/oppo-india/OppoHomePage';
import type { OppoHomePageOverrides } from '@/components/sites/oppo-india/OppoHomePage';
import { getContent, getContentMany, getThemeSettings } from '@/lib/content';

/** Admin edits must appear without a rebuild, so render per-request. */
export const dynamic = 'force-dynamic';

const DESCRIPTION =
  'Discover OPPO smartphones, tablets, audio accessories, and IoT products. Explore the latest Reno, Find, and F series phones with cutting-edge AI features powered by ColorOS.';

const metadata: Metadata = {
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

export async function generateMetadata(): Promise<Metadata> {
  const seo = await getContent<{ title?: string; description?: string }>('oppo.seo', {});
  return {
    ...metadata,
    title: seo.title ?? metadata.title,
    description: seo.description ?? DESCRIPTION,
    openGraph: {
      ...metadata.openGraph,
      title: seo.title ?? 'OPPO Official Site - OPPO India',
      description: seo.description ?? DESCRIPTION,
    },
  };
}

export default async function AndroidPage() {
  const c = await getContentMany({
    announce: ['oppo.announce', {}],
    nav: ['oppo.nav', {}],
    heroSlides: ['oppo.hero_slides', {}],
    hotSale: ['oppo.hot_sale', {}],
    products: ['oppo.products', {}],
    offers: ['oppo.offers', {}],
    explore: ['oppo.explore', {}],
    support: ['oppo.support', {}],
    community: ['oppo.community', {}],
    footer: ['oppo.footer', {}],
  });

  // Site-wide theme settings (Theme page in the admin panel) win over the
  // per-collection nav override when both are set.
  const settings = await getThemeSettings();

  const overrides: OppoHomePageOverrides = {
    announce: c.announce as OppoHomePageOverrides['announce'],
    announceEnabled: (c.announce as { enabled?: boolean }).enabled !== false,
    nav: settings.logoText
      ? { ...(c.nav as OppoHomePageOverrides['nav']), logoText: settings.logoText }
      : (c.nav as OppoHomePageOverrides['nav']),
    heroSlides: (c.heroSlides as { slides?: OppoHomePageOverrides['heroSlides'] }).slides,
    heroEnabled: (c.heroSlides as { enabled?: boolean }).enabled !== false,
    hotSale: c.hotSale as OppoHomePageOverrides['hotSale'],
    hotSaleEnabled: (c.hotSale as { enabled?: boolean }).enabled !== false,
    products: (c.products as { items?: OppoHomePageOverrides['products'] }).items,
    productsEnabled: (c.products as { enabled?: boolean }).enabled !== false,
    offersHeading: (c.offers as { heading?: string }).heading,
    offers: (c.offers as { items?: OppoHomePageOverrides['offers'] }).items,
    offersEnabled: (c.offers as { enabled?: boolean }).enabled !== false,
    exploreHeading: (c.explore as { heading?: string }).heading,
    explore: (c.explore as { items?: OppoHomePageOverrides['explore'] }).items,
    exploreEnabled: (c.explore as { enabled?: boolean }).enabled !== false,
    supportHeading: (c.support as { heading?: string }).heading,
    supportItems: (c.support as { items?: string[] }).items,
    supportEnabled: (c.support as { enabled?: boolean }).enabled !== false,
    community: c.community as OppoHomePageOverrides['community'],
    communityEnabled: (c.community as { enabled?: boolean }).enabled !== false,
    footer: c.footer as OppoHomePageOverrides['footer'],
  };

  return <OppoHomePage overrides={overrides} />;
}
