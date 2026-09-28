/**
 * Bridges the admin panel's simplified edit shape onto the full generated
 * tile/nav data structures. The admin editor edits flat fields (headline,
 * subheadText, imageSrc, cta labels/hrefs); these helpers merge such an
 * override onto the hardcoded defaults — every field the editor did not set
 * keeps its original value, so an unedited site renders identically.
 */

import type { Tile, SubheadSegment, PictureData, PictureSource } from './data/tiles';
import type { NavItem } from './data/nav';

/* ------------------------------------------------------- shared image sizes */

/**
 * The art-directed size slots the admin panel exposes. They map onto the
 * breakpoints the site's <picture> sources use:
 *   small   — (max-width: 734px)        small2x — its @2x variant
 *   medium  — (max-width: 1068px)       medium2x — its @2x variant
 *   large   — everything wider          large2x  — its @2x variant
 * Hero tiles additionally carry mediumtall/largetall variants; those fall in
 * the medium/large buckets respectively (same width class).
 */
export interface ResponsiveImageOverride {
  imageSrc?: string;
  imageSmallSrc?: string;
  imageSmall2xSrc?: string;
  imageMediumSrc?: string;
  imageMedium2xSrc?: string;
  imageLargeSrc?: string;
  imageLarge2xSrc?: string;
}

/** Which breakpoint bucket a media query belongs to. */
function mediaBucket(media: string): 'small' | 'medium' | 'large' {
  // "max-width:734px" → small; "max-width:1068px" (any height variant) →
  // medium; min-width:0px / everything else → large.
  if (/\(max-width:\s*734px\)/.test(media)) return 'small';
  if (/\(max-width:\s*1068px\)/.test(media)) return 'medium';
  return 'large';
}

/**
 * Merge per-size image uploads onto an art-directed PictureData. Each of the
 * six slots replaces only the sources in its bucket; blank/unset slots keep
 * the originals, so an unedited picture is untouched. When any slot is set
 * the plain <img> fallback src takes the large 1x value (or the first set
 * slot) so every browser gets something.
 */
export function applyResponsiveImage(
  base: PictureData | null,
  o: ResponsiveImageOverride | undefined,
): PictureData | null {
  if (!o) return base;
  const byBucket: Record<'small' | 'medium' | 'large', { src?: string; src2x?: string }> = {
    small: { src: o.imageSmallSrc || undefined, src2x: o.imageSmall2xSrc || undefined },
    medium: { src: o.imageMediumSrc || undefined, src2x: o.imageMedium2xSrc || undefined },
    large: { src: o.imageLargeSrc || undefined, src2x: o.imageLarge2xSrc || undefined },
  };
  // The legacy single-src field replaces every bucket's 1x slot (and 2x when
  // nothing more specific is given) — the "one image everywhere" shortcut.
  const anyBucketSet = Object.values(byBucket).some((b) => b.src || b.src2x);
  if (!anyBucketSet && !o.imageSrc) return base;

  if (!base) {
    // No original picture (shouldn't happen for tiles, but be safe).
    const src = o.imageSrc ?? o.imageLargeSrc ?? o.imageMediumSrc ?? o.imageSmallSrc ?? '';
    if (!src) return base;
    return {
      sources: [{ media: '(min-width:0px)', src, src2x: null }],
      img: { src, alt: '', width: null, height: null },
    };
  }

  const sources: PictureSource[] = base.sources.map((source) => {
    const bucket = mediaBucket(source.media);
    const slot = byBucket[bucket];
    // Legacy single upload wins only where the bucket has nothing specific.
    const src = slot.src ?? (o.imageSrc || source.src);
    const src2x = slot.src2x ?? (o.imageSrc && !slot.src ? null : source.src2x);
    return { ...source, src, src2x };
  });
  const imgSrc =
    o.imageLargeSrc || o.imageSrc || o.imageMediumSrc || o.imageSmallSrc || base.img.src;
  return { sources, img: { ...base.img, src: imgSrc, width: null, height: null } };
}

/* --------------------------------------------------------------- tiles */

export interface TileOverride extends ResponsiveImageOverride {
  headline?: string;
  subheadText?: string;
  href?: string;
  ctas?: { label?: string; href?: string }[];
  infoTooltip?: string;
}

export function mergeTile(tile: Tile, override: TileOverride | undefined): Tile {
  if (!override) return tile;
  return {
    ...tile,
    href: override.href ?? tile.href,
    // A non-empty edited headline replaces a logo headline (the editor can
    // only edit text; the empty pre-filled value keeps the original logo).
    headline: override.headline ?? tile.headline,
    headlineLogo: override.headline ? null : tile.headlineLogo,
    subhead: override.subheadText !== undefined
      ? [{ kind: 'text', value: override.subheadText }]
      : tile.subhead,
    ctas: [
      // Merge over the longer of the two — the editor exposes two CTA slots,
      // so a second CTA on a one-CTA tile must render, not be dropped. Empty
      // labels (the editor's unused second slot) render nothing.
      ...Array.from(
        { length: Math.max(tile.ctas.length, override.ctas?.length ?? 0) },
        (_, i) => {
          const cta = tile.ctas[i];
          const o = override.ctas?.[i];
          if (!cta) {
            return {
              label: o?.label ?? '',
              href: o?.href ?? '#',
              ariaLabel: o?.label ?? null,
              variant: 'secondary' as const,
            };
          }
          if (!o) return cta;
          return { ...cta, label: o.label ?? cta.label, href: o.href ?? cta.href };
        },
      ),
    ].filter((cta) => cta.label),
    image: applyResponsiveImage(tile.image, override),
    infoTooltip: override.infoTooltip !== undefined && override.infoTooltip !== ''
      ? override.infoTooltip
      : (tile.index === 0 && tile.group === 'hero'
          ? (override.infoTooltip === '' ? null : (tile.infoTooltip ?? '🎓 Student Discount: Verified students with a valid university email (.edu) and student ID can unlock exclusive pricing and special discounts on select products, plus free accessories with qualifying purchases.'))
          : (tile.infoTooltip ?? null)),
  };
}

export function mergeTiles(tiles: Tile[], overrides: TileOverride[] | undefined): Tile[] {
  if (!overrides) return tiles;
  // Override array length wins — extras clone the last default tile as a
  // template so a newly added tile still renders (editor pre-fills its fields).
  // Extra tiles need unique `index` values (used as React keys).
  return overrides.map((override, i) => {
    const template = tiles[i] ?? tiles[tiles.length - 1];
    const merged = mergeTile(template, override);
    return tiles[i] ? merged : { ...merged, index: (template?.index ?? 0) + 1 + i - tiles.length };
  });
}

/* ----------------------------------------------------------------- nav */

export interface NavLabelsOverride {
  items?: { label?: string; href?: string }[];
  searchPlaceholder?: string;
}

export function mergeNavItems(
  items: NavItem[],
  override: NavLabelsOverride | undefined,
): NavItem[] {
  const overrides = override?.items;
  if (!overrides) return items;
  // Override array length wins: extras become text-label nav items (no
  // wordmark — desktop falls back to the plain label; added items have no
  // flyout menu, matching a plain link).
  return overrides.map((o, i) => {
    const item = items[i];
    if (!item) {
      return {
        key: `admin-item-${i}`,
        label: o.label ?? '',
        href: o.href ?? '#',
        ariaLabel: o.label ?? '',
        wordmark: { viewBox: '0 0 1 1', width: 1, height: 1, paths: [] },
      };
    }
    if (!o) return item;
    return { ...item, label: o.label ?? item.label, href: o.href ?? item.href };
  });
}

/* ------------------------------------------------------- footer + banner */

export interface FooterOverride {
  footnotesHtml?: string;
  copyright?: string;
  localeLabel?: string;
  localeHref?: string;
}

export interface LocaleBannerOverride {
  copy?: string;
  selectedLabel?: string;
  continueLabel?: string;
  continueHref?: string;
}

export interface RibbonOverride {
  text?: string;
  shopHref?: string;
}

export interface GalleryItemOverride extends ResponsiveImageOverride {
  title?: string;
}

export interface GalleryOverride {
  heading?: string;
  items?: GalleryItemOverride[];
  secondRowEnabled?: boolean;
}

/**
 * The Back to School hero tile's video stage (the motion under "College,
 * sorted."): one poster image plus up to three autoplaying clips positioned
 * left-to-right. Every field is optional — unset clips keep their original
 * src/position; a blanked clip src keeps the original video.
 */
export interface HeroVideoClipOverride {
  label?: string;
  src?: string;
  /** px from the stage's left edge. */
  left?: string;
  /** px render width. */
  width?: string;
}

export interface HeroVideoOverride extends ResponsiveImageOverride {
  clips?: HeroVideoClipOverride[];
  /** false = the video stage is hidden; the tile keeps its poster image. */
  enabled?: boolean;
}

/** Subhead segments from plain text (used by tests and future consumers). */
export function subheadFromText(text: string): SubheadSegment[] {
  return [{ kind: 'text', value: text }];
}
