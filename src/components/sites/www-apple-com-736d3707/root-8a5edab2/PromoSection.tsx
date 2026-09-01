import { PROMO_TILES } from './data/tiles';
import { TileCard } from './TileCard';

/**
 * `.section-promo` — six tiles. One column and full-bleed below 735px, two equal
 * columns with 12px side padding above it; 12px gutters throughout.
 */
export function PromoSection() {
  return (
    <section className="mb-[12px] text-center">
      <div className="pt-[36px] pb-[17px] al:pt-[53px] al:pb-[26px]">
        <h2
          className="text-center text-[40px] leading-[44px] font-semibold tracking-[0.128px] al:text-[72px] al:leading-[76px] al:tracking-[-0.28px]"
          style={{ fontFamily: 'var(--ac-font-display)' }}
        >
          Explore Accessories
        </h2>
      </div>
      <div className="grid grid-cols-1 gap-[12px] am:grid-cols-2 am:px-[12px]">
        {PROMO_TILES.map((tile) => (
          <TileCard key={tile.index} tile={tile} />
        ))}
      </div>
    </section>
  );
}
