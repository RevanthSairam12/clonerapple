'use client';

import { useState } from 'react';

import { EndlessEntertainmentGallery } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/EndlessEntertainmentGallery';
import { GlobalFooter } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/GlobalFooter';
import { GlobalNav } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/GlobalNav';
import { HeroSection } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/HeroSection';
import { GadzioHeroSection } from '@/components/hero/GadzioHeroSection';
import { LocaleBanner } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/LocaleBanner';
import { PromoSection } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/PromoSection';
import { Ribbon } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/Ribbon';
import type {
  FooterOverride,
  GalleryOverride,
  HeroVideoOverride,
  LocaleBannerOverride,
  NavLabelsOverride,
  RibbonOverride,
  TileOverride,
} from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/admin-overrides';

/**
 * Page shell for the Gadzio storefront homepage.
 *
 * The header is `sticky`, so it stays in the document flow and already
 * reserves its own height (promo bar + nav). Flow content below therefore
 * needs no nav-height padding — it starts directly under the header.
 *
 * All props are admin-panel overrides; each defaults to the original
 * hardcoded content so an unedited page renders identically.
 */
export interface HomePageOverrides {
  heroTiles?: TileOverride[];
  /** Back to School video stage (tile 1 motion). */
  heroVideo?: HeroVideoOverride;
  promoHeading?: string;
  promoTiles?: TileOverride[];
  /** false = section disabled in the admin panel. */
  promoEnabled?: boolean;
  ribbon?: RibbonOverride;
  /** false = section disabled in the admin panel. */
  ribbonEnabled?: boolean;
  navLabels?: NavLabelsOverride;
  footer?: FooterOverride;
  localeBanner?: LocaleBannerOverride;
  /** false = section disabled in the admin panel. */
  localeBannerEnabled?: boolean;
  gallery?: GalleryOverride;
  /** false = section disabled in the admin panel. */
  galleryEnabled?: boolean;
}

export function GadzioHomePage({ overrides }: { overrides?: HomePageOverrides } = {}) {
  const [bannerVisible, setBannerVisible] = useState(false);

  return (
    <div className="gz-root">
      {bannerVisible && overrides?.localeBannerEnabled !== false ? (
        <LocaleBanner onDismiss={() => setBannerVisible(false)} content={overrides?.localeBanner} />
      ) : null}
      <GlobalNav bannerVisible={bannerVisible} labels={overrides?.navLabels} />

      <h1 className="gz-visuallyhidden">Gadzio</h1>

      <main>
        {overrides?.ribbonEnabled !== false ? <Ribbon content={overrides?.ribbon} /> : null}

        {/* =========================================================================
            PREVIOUS HERO SECTION (KEPT COMMENTED AS REQUESTED - DO NOT REMOVE)
            ========================================================================= */}
        {/* <HeroSection tiles={overrides?.heroTiles} video={overrides?.heroVideo} /> */}

        {/* ACTIVE GADZIO HERO SECTION */}
        <GadzioHeroSection />
        {overrides?.promoEnabled !== false ? (
          <PromoSection heading={overrides?.promoHeading} tiles={overrides?.promoTiles} />
        ) : null}
        {overrides?.galleryEnabled !== false ? (
          <EndlessEntertainmentGallery content={overrides?.gallery} />
        ) : null}
      </main>

      <GlobalFooter content={overrides?.footer} />
    </div>
  );
}
