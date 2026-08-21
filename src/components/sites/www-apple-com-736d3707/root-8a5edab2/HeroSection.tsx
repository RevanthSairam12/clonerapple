import { HERO_INLINE_MEDIA, HERO_TILES } from './data/tiles';
import { HeroInlineMedia } from './HeroInlineMedia';
import { TileCard } from './TileCard';

/**
 * `.section-hero` — three full-bleed tiles in a single-column grid with a 12px
 * gap and a 12px bottom margin. Tile 1 additionally hosts the video stage.
 */
export function HeroSection() {
  return (
    <section className="mb-[12px] grid grid-cols-1 gap-[12px] text-center">
      {HERO_TILES.map((tile, i) => (
        <TileCard key={tile.index} tile={tile} priority={i === 0}>
          {i === 0 && tile.startFrame ? (
            <HeroInlineMedia
              startFrame={tile.startFrame}
              stageWidth={HERO_INLINE_MEDIA.stageWidth}
              stageHeight={HERO_INLINE_MEDIA.stageHeight}
              clips={HERO_INLINE_MEDIA.clips}
            />
          ) : null}
        </TileCard>
      ))}
    </section>
  );
}
