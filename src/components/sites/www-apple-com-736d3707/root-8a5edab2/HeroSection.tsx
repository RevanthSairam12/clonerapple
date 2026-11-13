import { HERO_INLINE_MEDIA, HERO_TILES, type Tile } from './data/tiles';
import { HeroInlineMedia } from './HeroInlineMedia';
import { TileCard } from './TileCard';
import { mergeTiles, type HeroVideoOverride, type TileOverride } from './admin-overrides';

/**
 * `.section-hero` — full-bleed showcase tiles in a single-column grid with a
 * 12px gap and a 12px bottom margin. Old UI hosts the optional video stage.
 */
export function HeroSection({
  tiles: tilesOverride,
  video,
  baseTiles = HERO_TILES,
  enableVideo = true,
}: {
  tiles?: TileOverride[];
  /** Admin overrides for the Back to School video stage (tile 1). */
  video?: HeroVideoOverride;
  /** Base tile dataset (defaults to Old UI HERO_TILES). */
  baseTiles?: Tile[];
  /** Whether tile 0 may render the optional video stage. */
  enableVideo?: boolean;
} = {}) {
  const tiles = mergeTiles(baseTiles, tilesOverride);

  return (
    <section className="mb-[12px] grid grid-cols-1 gap-[12px] text-center">
      {tiles.map((tile, i) => (
        <TileCard key={tile.index} tile={tile} priority={enableVideo && i === 0}>
          {enableVideo && i === 0 && tile.startFrame && video?.enabled === true ? (
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
