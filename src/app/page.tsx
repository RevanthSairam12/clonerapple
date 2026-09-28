import type { Metadata } from 'next';

import { AppleHomePage } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/AppleHomePage';
import type { HomePageOverrides } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/AppleHomePage';
import { getContent, getContentMany, getThemeSettings } from '@/lib/content';

/** Admin edits must appear without a rebuild, so render per-request. */
export const dynamic = 'force-dynamic';

const DESCRIPTION =
  'Discover the innovative world of Apple and shop everything iPhone, iPad, Apple Watch, Mac, and Apple TV, plus explore accessories, entertainment, and expert device support.';

const metadata: Metadata = {
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

/** Builds metadata with any admin SEO overrides applied over the defaults. */
async function buildMetadata(): Promise<Metadata> {
  const seo = await getContent<{ title?: string; description?: string; ogTitle?: string }>(
    'apple.seo',
    {},
  );
  return {
    ...metadata,
    title: seo.title ?? metadata.title,
    description: seo.description ?? DESCRIPTION,
    openGraph: {
      ...metadata.openGraph,
      title: seo.ogTitle ?? seo.title ?? 'Apple',
      description: seo.description ?? DESCRIPTION,
    },
  };
}

export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata();
}

export default async function Home() {
  // One round-trip: every homepage collection, with hardcoded fallbacks.
  const c = await getContentMany({
    heroTiles: ['apple.hero_tiles', {}],
    heroVideo: ['apple.hero_video', {}],
    promo: ['apple.promo_section', {}],
    ribbon: ['apple.ribbon', {}],
    localeBanner: ['apple.locale_banner', {}],
    nav: ['apple.nav', {}],
    footer: ['apple.footer', {}],
    gallery: ['apple.gallery', {}],
  });

  // Site-wide theme settings (Theme page in the admin panel) win over the
  // per-collection footer override when both are set.
  const settings = await getThemeSettings();
  const footerOverride: HomePageOverrides['footer'] = settings.appleCopyright
    ? { ...(c.footer as HomePageOverrides['footer']), copyright: settings.appleCopyright }
    : (c.footer as HomePageOverrides['footer']);

  const overrides: HomePageOverrides = {
    heroTiles: (c.heroTiles as { heroTiles?: HomePageOverrides['heroTiles'] }).heroTiles,
    heroVideo: c.heroVideo as HomePageOverrides['heroVideo'],
    promoHeading: (c.promo as { heading?: string }).heading,
    promoTiles: (c.promo as { promoTiles?: HomePageOverrides['promoTiles'] }).promoTiles,
    promoEnabled: (c.promo as { enabled?: boolean }).enabled !== false,
    ribbon: c.ribbon as HomePageOverrides['ribbon'],
    ribbonEnabled: (c.ribbon as { enabled?: boolean }).enabled !== false,
    localeBanner: c.localeBanner as HomePageOverrides['localeBanner'],
    localeBannerEnabled: (c.localeBanner as { enabled?: boolean }).enabled !== false,
    navLabels: c.nav as HomePageOverrides['navLabels'],
    footer: footerOverride,
    gallery: c.gallery as HomePageOverrides['gallery'],
    galleryEnabled: (c.gallery as { enabled?: boolean }).enabled !== false,
  };

  return <AppleHomePage overrides={overrides} />;
}
