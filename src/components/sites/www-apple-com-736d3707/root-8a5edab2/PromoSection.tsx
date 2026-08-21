import { PROMO_TILES } from './data/tiles';
import { TileCard } from './TileCard';

/**
 * `.section-promo` — six tiles. One column and full-bleed below 735px, two equal
 * columns with 12px side padding above it; 12px gutters throughout.
 */
export function PromoSection() {
  return (
    <section className="mb-[12px] grid grid-cols-1 gap-[12px] text-center am:grid-cols-2 am:px-[12px]">
      {PROMO_TILES.map((tile) => (
        <TileCard key={tile.index} tile={tile} />
      ))}
    </section>
  );
}
