import { ArtDirectedPicture } from './ArtDirectedPicture';
import type { InlineMediaClip, PictureData } from './data/tiles';

interface HeroInlineMediaProps {
  startFrame: PictureData;
  stageWidth: number;
  stageHeight: number;
  clips: InlineMediaClip[];
}

/**
 * The Back to School tile's video stage (>=1069px only).
 *
 * A 1222x460 stage sits 232px below the tile's top edge, centred and clipped by
 * the tile. The start-frame PNG is the poster; three clips play over it at the
 * measured offsets. The target's fourth (composite) video renders at opacity 0
 * and is intentionally omitted — see BEHAVIORS.md §3.
 */
export function HeroInlineMedia({ startFrame, stageWidth, stageHeight, clips }: HeroInlineMediaProps) {
  return (
    <div
      className="absolute left-1/2 hidden -translate-x-1/2 al:block"
      style={{ top: '232px', width: `${stageWidth}px`, height: `${stageHeight}px` }}
    >
      <ArtDirectedPicture
        data={startFrame}
        className="block"
        imgClassName="absolute inset-0 h-full w-full max-w-none object-cover"
        imgStyle={{ objectPosition: '50% 30%' }}
      />
      {clips.map((clip) => (
        <video
          key={clip.id}
          id={clip.id}
          className="absolute top-0 h-full max-w-none object-cover"
          style={{ left: `${clip.left - 109}px`, width: `${clip.width}px`, objectPosition: '50% 30%' }}
          src={clip.src}
          autoPlay
          muted
          playsInline
          preload="auto"
        />
      ))}
    </div>
  );
}
