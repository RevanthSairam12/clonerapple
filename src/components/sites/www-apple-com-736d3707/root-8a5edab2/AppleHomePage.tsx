'use client';

import { useState } from 'react';

import { cn } from '@/lib/utils';

import { EndlessEntertainmentGallery } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/EndlessEntertainmentGallery';
import { GlobalFooter } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/GlobalFooter';
import { GlobalNav } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/GlobalNav';
import { HeroSection } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/HeroSection';
import { LocaleBanner } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/LocaleBanner';
import { PromoSection } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/PromoSection';

/**
 * Page shell for the www.apple.com/ clone.
 *
 * The locale banner and nav are both fixed, so the flow content carries their
 * combined height as padding: 70 + 44 = 114px at >=834px and 135 + 48 = 183px
 * below it. Dismissing the banner drops that to just the nav height (44 / 48),
 * exactly as measured on the target.
 */
export function AppleHomePage() {
  const [bannerVisible, setBannerVisible] = useState(true);

  return (
    <div className="ac-root">
      {bannerVisible ? <LocaleBanner onDismiss={() => setBannerVisible(false)} /> : null}
      <GlobalNav bannerVisible={bannerVisible} />

      <h1 className="ac-visuallyhidden">Apple</h1>

      <main
        className={cn(
          bannerVisible ? 'pt-[183px] anav:pt-[114px]' : 'pt-[48px] anav:pt-[44px]',
        )}
      >
        <HeroSection />
        <PromoSection />
        <EndlessEntertainmentGallery />
      </main>

      <GlobalFooter />
    </div>
  );
}
