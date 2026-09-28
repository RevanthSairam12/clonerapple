'use client';

import { useState } from 'react';

import { cn } from '@/lib/utils';

import { EndlessEntertainmentGallery } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/EndlessEntertainmentGallery';
import { GlobalFooter } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/GlobalFooter';
import { GlobalNav } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/GlobalNav';
import { HeroSection } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/HeroSection';
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
 * Page shell for the www.apple.com/ clone.
 *
 * The locale banner and nav are both fixed, so the flow content carries their
 * combined height as padding: 70 + 44 = 114px at >=834px and 135 + 48 = 183px
 * below it. Dismissing the banner drops that to just the nav height (44 / 48),
 * exactly as measured on the target.
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

export function AppleHomePage({ overrides }: { overrides?: HomePageOverrides } = {}) {
  const [bannerVisible, setBannerVisible] = useState(false);

  return (
    <div className="ac-root">
      {bannerVisible && overrides?.localeBannerEnabled !== false ? (
        <LocaleBanner onDismiss={() => setBannerVisible(false)} content={overrides?.localeBanner} />
      ) : null}
      <GlobalNav bannerVisible={bannerVisible} labels={overrides?.navLabels} />

      <h1 className="ac-visuallyhidden">Apple</h1>

      <main
        className={cn(
          bannerVisible ? 'pt-[183px] anav:pt-[114px]' : 'pt-[48px] anav:pt-[44px]',
        )}
      >
        {overrides?.ribbonEnabled !== false ? <Ribbon content={overrides?.ribbon} /> : null}
        <HeroSection tiles={overrides?.heroTiles} video={overrides?.heroVideo} />
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
