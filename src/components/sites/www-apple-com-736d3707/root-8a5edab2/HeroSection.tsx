import { HERO_INLINE_MEDIA, HERO_TILES } from './data/tiles';
import { HeroInlineMedia } from './HeroInlineMedia';
import { TileCard } from './TileCard';
import { mergeTiles, type HeroVideoOverride, type TileOverride } from './admin-overrides';

/**
 * `.section-hero` — three full-bleed tiles in a single-column grid with a 12px
 * gap and a 12px bottom margin. Tile 1 additionally hosts the video stage.
 */
export function HeroSection({
  tiles: tilesOverride,
  video,
}: {
  tiles?: TileOverride[];
  /** Admin overrides for the Back to School video stage (tile 1). */
  video?: HeroVideoOverride;
} = {}) {
  const tiles = mergeTiles(HERO_TILES, tilesOverride);

  return (
    <section className="mb-[12px] grid grid-cols-1 gap-[12px] text-center">
      {tiles.map((tile, i) => (
        <TileCard key={tile.index} tile={tile} priority={i === 0}>
          {i === 0 && tile.startFrame && video?.enabled === true ? (
            <HeroInlineMedia
              startFrame={tile.startFrame}
              stageWidth={HERO_INLINE_MEDIA.stageWidth}
              stageHeight={HERO_INLINE_MEDIA.stageHeight}
              clips={HERO_INLINE_MEDIA.clips}
              override={video}
            />
          ) : null}
        </TileCard>
      ))}
    </section>
  );
}
