import { ExploreAccessoriesHeader } from './ExploreAccessoriesHeader';
import { PROMO_TILES } from './data/tiles';
import { TileCard } from './TileCard';
import { mergeTiles, type TileOverride } from './admin-overrides';

/**
 * `.section-promo` — six tiles. One column and full-bleed below 735px, two equal
 * columns with 12px side padding above it; 12px gutters throughout.
 */
export function PromoSection({
  heading = 'Explore Accessories',
  tiles: tilesOverride,
}: {
  heading?: string;
  tiles?: TileOverride[];
} = {}) {
  const tiles = mergeTiles(PROMO_TILES, tilesOverride);

  return (
    <section className="mb-[12px] text-center overflow-hidden">
      <ExploreAccessoriesHeader heading={heading} />
      <div className="grid grid-cols-1 gap-[12px] am:grid-cols-2 am:px-[12px]">
        {tiles.map((tile) => (
          <TileCard key={tile.index} tile={tile} />
        ))}
      </div>
    </section>
  );
}
