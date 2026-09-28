import { ArtDirectedPicture } from './ArtDirectedPicture';
import type { InlineMediaClip, PictureData } from './data/tiles';
import { applyResponsiveImage, type HeroVideoOverride } from './admin-overrides';

interface HeroInlineMediaProps {
  startFrame: PictureData;
  stageWidth: number;
  stageHeight: number;
  clips: InlineMediaClip[];
  /** Admin overrides: per-size poster + per-clip video/position. */
  override?: HeroVideoOverride;
}

/**
 * The Back to School tile's video stage (>=1069px only).
 *
 * A 1222x460 stage sits 232px below the tile's top edge, centred and clipped by
 * the tile. The start-frame PNG is the poster; three clips play over it at the
 * measured offsets. The target's fourth (composite) video renders at opacity 0
 * and is intentionally omitted — see BEHAVIORS.md §3.
 *
 * Admin overrides replace the poster (per breakpoint size) and each clip's
 * video/position; an unset field keeps the original value, so an unedited
 * stage is pixel-identical.
 */
export function HeroInlineMedia({ startFrame, stageWidth, stageHeight, clips, override }: HeroInlineMediaProps) {
  // Poster: per-size uploads replace the matching breakpoint source.
  const poster = applyResponsiveImage(startFrame, override) ?? startFrame;

  return (
    <div
      className="absolute left-1/2 hidden -translate-x-1/2 al:block"
      style={{ top: '232px', width: `${stageWidth}px`, height: `${stageHeight}px` }}
    >
      <ArtDirectedPicture
        data={poster}
        className="block"
        imgClassName="absolute inset-0 h-full w-full max-w-none object-cover"
        imgStyle={{ objectPosition: '50% 30%' }}
      />
      {clips.map((clip, i) => {
        const o = override?.clips?.[i];
        // Numeric overrides arrive as strings from the editor; blank keeps
        // the original positioning.
        const left = o?.left !== undefined && o.left !== '' ? Number(o.left) : clip.left;
        const width = o?.width !== undefined && o.width !== '' ? Number(o.width) : clip.width;
        const src = o?.src || clip.src;
        return (
          <video
            key={clip.id}
            id={clip.id}
            className="absolute top-0 h-full max-w-none object-cover"
            style={{ left: `${left - 109}px`, width: `${width}px`, objectPosition: '50% 30%' }}
            src={src}
            autoPlay
            muted
            playsInline
            preload="auto"
          />
        );
      })}
    </div>
  );
}
