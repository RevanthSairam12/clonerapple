import type { CSSProperties } from 'react';

import { cn } from '@/lib/utils';

import type { PictureData } from './data/tiles';

interface ArtDirectedPictureProps {
  data: PictureData;
  className?: string;
  imgClassName?: string;
  imgStyle?: CSSProperties;
  /** Emit intrinsic width/height attributes (logo images size themselves). */
  intrinsic?: boolean;
  fetchPriority?: 'high' | 'low' | 'auto';
  loading?: 'eager' | 'lazy';
}

/**
 * The target art-directs every image with `<picture><source media=…>` — a
 * different crop (and aspect ratio) per breakpoint, sometimes per viewport
 * height. `next/image` cannot express that, so the clone keeps the original
 * markup and serves the downloaded files verbatim.
 */
export function ArtDirectedPicture({
  data,
  className,
  imgClassName,
  imgStyle,
  intrinsic = false,
  fetchPriority,
  loading,
}: ArtDirectedPictureProps) {
  return (
    <picture className={className}>
      {data.sources.map((source) => (
        <source
          key={`${source.media}|${source.src}`}
          media={source.media}
          srcSet={source.src2x ? `${source.src}, ${source.src2x} 2x` : source.src}
        />
      ))}
      <img
        src={data.img.src}
        alt={data.img.alt}
        {...(intrinsic && data.img.width && data.img.height
          ? { width: data.img.width, height: data.img.height }
          : {})}
        className={cn(imgClassName)}
        style={imgStyle}
        fetchPriority={fetchPriority}
        loading={loading}
      />
    </picture>
  );
}
