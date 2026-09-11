import { cn } from '@/lib/utils';

export interface RibbonProps {
  className?: string;
}

/**
 * `.homepage-section[data-module-template="ribbon"]` — ribbon headline strip
 * placed immediately below the global navigation bar.
 *
 * Matches Apple India (apple.com/in) promotional copy:
 * "Get up to 6 months of No Cost EMI* plus up to ₹15000 instant cashback‡ on selected products with eligible cards. Shop ›"
 */
export function Ribbon({ className }: RibbonProps) {
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
          Get up to 6 months of No Cost EMI
          <sup className="ml-[1px] text-[10px] leading-none align-super font-normal">
            <a
              href="#footnote-*"
              aria-label="Footnote *"
              className="text-[#1d1d1f] hover:text-[#0071e3] transition-colors"
            >
              *
            </a>
          </sup>{' '}
          plus up to ₹15000 instant cashback
          <sup className="ml-[1px] text-[10px] leading-none align-super font-normal">
            <a
              href="#footnote-‡"
              aria-label="Footnote ‡"
              className="text-[#1d1d1f] hover:text-[#0071e3] transition-colors"
            >
              ‡
            </a>
          </sup>{' '}
          on selected products with eligible cards.{' '}
          <a
            href="https://www.apple.com/in/shop/goto/store"
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
