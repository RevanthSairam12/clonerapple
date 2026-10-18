import type { Metadata } from 'next';

import { GadzioHomePage } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/GadzioHomePage';
import type { HomePageOverrides } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/GadzioHomePage';
import { getContent, getContentMany, getThemeSettings } from '@/lib/content';

/** Admin edits must appear without a rebuild, so render per-request. */
export const dynamic = 'force-dynamic';

const DESCRIPTION =
  'Shop Gadzio mobile accessories, cases, chargers, cables, audio accessories and everyday tech essentials.';

const metadata: Metadata = {
  metadataBase: new URL('https://gadzio.in'),
  title: 'Gadzio',
  description: DESCRIPTION,
  openGraph: {
    title: 'Gadzio',
    description: DESCRIPTION,
    url: 'https://gadzio.in/',
    siteName: 'Gadzio',
    locale: 'en_US',
    type: 'website',
    images: ['/sites/www-apple-com-736d3707/root-8a5edab2/seo/open_graph_logo.png'],
  },
  icons: {
    icon: '/gadzio_logo.png',
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
      title: seo.ogTitle ?? seo.title ?? 'Gadzio',
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
    // No row = hidden. The gallery is the one block with no Gadzio content to
    // fall back to: its captured items were all Apple-owned destinations, so
    // the code data is empty and rendering it with nothing to show would paint
    // an empty band. Show it again by saving a row with enabled: true AND
    // Gadzio items from the admin panel.
    gallery: ['apple.gallery', { enabled: false }],
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

  return <GadzioHomePage overrides={overrides} />;
}
