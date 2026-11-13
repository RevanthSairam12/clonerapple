'use client';

import { useState } from 'react';

import { EndlessEntertainmentGallery } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/EndlessEntertainmentGallery';
import { GlobalFooter } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/GlobalFooter';
import { GlobalNav } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/GlobalNav';
import { HeroSection } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/HeroSection';
import { NEW_UI_HERO_TILES } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/data/tiles';
import { GadzioHeroSection } from '@/components/hero/GadzioHeroSection';
import { GadzioTrustBar } from '@/components/trust/GadzioTrustBar';
import { GadzioCategoryGrid } from '@/components/categories/GadzioCategoryGrid';
import { GadzioBrandBar } from '@/components/brands/GadzioBrandBar';
import { GadzioDiwaliSection } from '@/components/diwali/GadzioDiwaliSection';
import { GadzioCrowdFavorites } from '@/components/crowd-favorites/GadzioCrowdFavorites';
import { GadzioReviewsSection } from '@/components/reviews/GadzioReviewsSection';
import { GadzioInTheWild } from '@/components/ugc/GadzioInTheWild';
import { GadzioEventBanner } from '@/components/banner/GadzioEventBanner';
import { LocaleBanner } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/LocaleBanner';
import { PromoSection } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/PromoSection';
import { Ribbon } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/Ribbon';
import type {
  BrandBarOverride,
  CategoryGridOverride,
  CrowdFavoritesOverride,
  DiwaliCampaignOverride,
  EventBannerOverride,
  FooterOverride,
  GalleryOverride,
  HeroVideoOverride,
  InTheWildOverride,
  LocaleBannerOverride,
  NavLabelsOverride,
  ReviewsOverride,
  RibbonOverride,
  TileOverride,
  TrustBarOverride,
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
  /** Showcase Hero Tiles rendered in the New UI above Diwali & Crowd Favorites. */
  showcaseHeroTiles?: TileOverride[];
  /** false = New UI showcase hero tiles hidden from admin panel. */
  showcaseHeroTilesEnabled?: boolean;
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

  /* New UI sections from attached design */
  trustBar?: TrustBarOverride;
  trustBarEnabled?: boolean;
  categoryGrid?: CategoryGridOverride;
  categoryGridEnabled?: boolean;
  brandBar?: BrandBarOverride;
  brandBarEnabled?: boolean;
  diwaliCampaign?: DiwaliCampaignOverride;
  diwaliCampaignEnabled?: boolean;
  crowdFavorites?: CrowdFavoritesOverride;
  crowdFavoritesEnabled?: boolean;
  reviews?: ReviewsOverride;
  reviewsEnabled?: boolean;
  inTheWild?: InTheWildOverride;
  inTheWildEnabled?: boolean;
  eventBanner?: EventBannerOverride;
  eventBannerEnabled?: boolean;
}

export function GadzioHomePage({
  overrides,
  uiMode = 'new',
}: {
  overrides?: HomePageOverrides;
  uiMode?: 'new' | 'old';
} = {}) {
  const [bannerVisible, setBannerVisible] = useState(false);

  return (
    <div className="gz-root" style={{ fontFamily: 'transducer, sans-serif' }}>
      {bannerVisible && overrides?.localeBannerEnabled !== false ? (
        <LocaleBanner onDismiss={() => setBannerVisible(false)} content={overrides?.localeBanner} />
      ) : null}
      <GlobalNav bannerVisible={bannerVisible} labels={overrides?.navLabels} />

      <h1 className="gz-visuallyhidden">Gadzio</h1>

      <main>
        {overrides?.ribbonEnabled !== false ? <Ribbon content={overrides?.ribbon} /> : null}

        {/* =========================================================================
            UI MODE SWITCH: ONE-CLICK SWITCHABLE FROM ADMIN PANEL
            ========================================================================= */}
        {uiMode === 'old' ? (
          /* OLD / CLASSIC UI: Original Showcase Layout */
          <>
            <HeroSection tiles={overrides?.heroTiles} video={overrides?.heroVideo} />
            {overrides?.promoEnabled !== false ? (
              <PromoSection heading={overrides?.promoHeading} tiles={overrides?.promoTiles} />
            ) : null}
            {overrides?.galleryEnabled !== false ? (
              <EndlessEntertainmentGallery content={overrides?.gallery} />
            ) : null}
          </>
        ) : (
          /* NEW / MODERN UI: Modern Gadzio Storefront */
          <>
            {/* 1. ACTIVE GADZIO HERO SECTION (UNCHANGED) */}
            <GadzioHeroSection />

            {/* 2. VALUE PROPOSITIONS & TRUST BADGES BAR */}
            {overrides?.trustBarEnabled !== false && overrides?.trustBar?.enabled !== false ? (
              <GadzioTrustBar
                items={overrides?.trustBar?.items as any}
                enabled={overrides?.trustBar?.enabled}
              />
            ) : null}

            {/* 3. 4-COLUMN CATEGORY GRID */}
            {overrides?.categoryGridEnabled !== false && overrides?.categoryGrid?.enabled !== false ? (
              <GadzioCategoryGrid
                heading={overrides?.categoryGrid?.heading}
                items={overrides?.categoryGrid?.items as any}
                enabled={overrides?.categoryGrid?.enabled}
              />
            ) : null}

            {/* 4. GADZIO BRAND LOGOS BAR */}
            {overrides?.brandBarEnabled !== false && overrides?.brandBar?.enabled !== false ? (
              <GadzioBrandBar
                items={overrides?.brandBar?.items as any}
                enabled={overrides?.brandBar?.enabled}
              />
            ) : null}

            {/* 4b. SHOWCASE HERO TILES (NEW UI, INDEPENDENT DATA FROM OLD UI) */}
            {overrides?.showcaseHeroTilesEnabled !== false ? (
              <HeroSection
                baseTiles={NEW_UI_HERO_TILES}
                tiles={overrides?.showcaseHeroTiles}
                enableVideo={false}
              />
            ) : null}

            {/* 5. DIWALI 2026 FESTIVE CAMPAIGN (FEATURE BANNER + LIMITED PRODUCT CAROUSEL) */}
            {overrides?.diwaliCampaignEnabled !== false && overrides?.diwaliCampaign?.enabled !== false ? (
              <GadzioDiwaliSection
                enabled={overrides?.diwaliCampaign?.enabled}
                bannerKicker={overrides?.diwaliCampaign?.bannerKicker}
                bannerTitle={overrides?.diwaliCampaign?.bannerTitle}
                bannerButtonLabel={overrides?.diwaliCampaign?.bannerButtonLabel}
                bannerButtonHref={overrides?.diwaliCampaign?.bannerButtonHref}
                bannerImage={overrides?.diwaliCampaign?.bannerImage}
                items={overrides?.diwaliCampaign?.items as any}
              />
            ) : null}

            {/* 6. THE CROWD FAVORITES PRODUCT CAROUSEL */}
            {overrides?.crowdFavoritesEnabled !== false && overrides?.crowdFavorites?.enabled !== false ? (
              <GadzioCrowdFavorites
                heading={overrides?.crowdFavorites?.heading}
                subtitle={overrides?.crowdFavorites?.subtitle}
                rightLinkLabel={overrides?.crowdFavorites?.rightLinkLabel}
                rightLinkHref={overrides?.crowdFavorites?.rightLinkHref}
                items={overrides?.crowdFavorites?.items as any}
                enabled={overrides?.crowdFavorites?.enabled}
              />
            ) : null}

            {/* 7. CUSTOMER REVIEWS & 4.9 AVERAGE STAR RATING */}
            {overrides?.reviewsEnabled !== false && overrides?.reviews?.enabled !== false ? (
              <GadzioReviewsSection
                kicker={overrides?.reviews?.kicker}
                heading={overrides?.reviews?.heading}
                subheading={overrides?.reviews?.subheading}
                items={overrides?.reviews?.items as any}
                enabled={overrides?.reviews?.enabled}
              />
            ) : null}

            {/* 8. COMMUNITY UGC GALLERY (BEAST IN THE WILD) */}
            {overrides?.inTheWildEnabled !== false && overrides?.inTheWild?.enabled !== false ? (
              <GadzioInTheWild
                heading={overrides?.inTheWild?.heading}
                subheading={overrides?.inTheWild?.subheading}
                items={overrides?.inTheWild?.items as any}
                enabled={overrides?.inTheWild?.enabled}
              />
            ) : null}

            {/* 9. FEATURE SPOTLIGHT / EVENT BANNER */}
            {overrides?.eventBannerEnabled !== false && overrides?.eventBanner?.enabled !== false ? (
              <GadzioEventBanner
                heading={overrides?.eventBanner?.heading}
                subtitle={overrides?.eventBanner?.subtitle}
                ctaLabel={overrides?.eventBanner?.ctaLabel}
                ctaHref={overrides?.eventBanner?.ctaHref}
                image={overrides?.eventBanner?.image}
                enabled={overrides?.eventBanner?.enabled}
              />
            ) : null}

            {/* 8. EXPLORE ACCESSORIES PROMO SECTION */}
            {overrides?.promoEnabled !== false ? (
              <PromoSection heading={overrides?.promoHeading} tiles={overrides?.promoTiles} />
            ) : null}

            {/* 9. SERVICES / MEDIA GALLERY */}
            {overrides?.galleryEnabled !== false ? (
              <EndlessEntertainmentGallery content={overrides?.gallery} />
            ) : null}
          </>
        )}
      </main>

      <GlobalFooter content={overrides?.footer} />
    </div>
  );
}
