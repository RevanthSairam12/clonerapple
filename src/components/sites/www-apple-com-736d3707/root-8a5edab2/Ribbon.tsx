import { cn } from '@/lib/utils';

import type { RibbonOverride } from './admin-overrides';

export interface RibbonProps {
  className?: string;
  /** Admin override: plain promo text and Shop link (defaults = live copy). */
  content?: RibbonOverride;
}

/**
 * `.homepage-section[data-module-template="ribbon"]` — ribbon headline strip
 * placed immediately below the global navigation bar.
 *
 * The fallback text is the de-branded promo Gadzio ships in its `apple.ribbon`
 * content row, so a missing/cleared row renders exactly what the live site
 * renders today. It replaces the previous hardcoded Apple India offer
 * ("6 months of No Cost EMI … instant cashback … eligible cards"), which was
 * Apple's own promotional claim and carried `*`/`‡` footnote markers pointing at
 * `#footnote-*` anchors that exist nowhere on the site.
 */
const DEFAULT_TEXT =
  'Unlock exclusive student pricing and massive savings this semester on all eligible device chargers, protective cases, and premium audio accessories.';

/** Gadzio's Cases & Protection listing — where the live ribbon row points. */
const DEFAULT_SHOP_HREF = '/shop/iphone/accessories/cases-protection';

export function Ribbon({ className, content }: RibbonProps) {
  // `||` (not `??`) so an override saved as an empty string still falls back.
  const text = content?.text || DEFAULT_TEXT;
  const shopHref = content?.shopHref || DEFAULT_SHOP_HREF;

  return (
    <section
      data-module-template="ribbon"
      aria-label="Offer"
      className={cn(
        'relative z-2 w-full bg-white text-[#1d1d1f] text-center overflow-hidden',
        className,
      )}
    >
      <div className="mx-auto flex items-center justify-center px-[16px] py-[12px] anav:py-[14px]">
        <p className="text-[14px] leading-[1.42857] tracking-[-0.016em] text-[#1d1d1f]">
          {text}{' '}
          <a
            href={shopHref}
            className="text-[#0071e3] hover:underline whitespace-nowrap inline-flex items-center gap-[2px]"
          >
            <span>Shop</span>
            <span aria-hidden="true" className="text-[13px] leading-none select-none">
              &rsaquo;
            </span>
          </a>
        </p>
      </div>
    </section>
  );
}
