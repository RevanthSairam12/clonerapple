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
 *   small      — (max-width: 734px)                    small2x      — @2x variant
 *   square     — 800 × 800 px                          compact      — 940 × 528 px
 *   medium     — (max-width: 1068px, max-height: 733)  medium2x     — @2x variant
 *   mediumTall — (max-width: 1068px, min-height: 734)  mediumTall2x — @2x variant
 *   large      — (>1068px, max-height: 775)            large2x      — @2x variant
 *   largeTall  — (>1068px, min-height: 776)            largeTall2x  — @2x variant
 */
export interface ResponsiveImageOverride {
  imageSrc?: string;
  imageSmallSrc?: string;
  imageSmall2xSrc?: string;
  imageSquareSrc?: string;
  imageCompactSrc?: string;
  imageMediumSrc?: string;
  imageMedium2xSrc?: string;
  imageMediumTallSrc?: string;
  imageMediumTall2xSrc?: string;
  imageLargeSrc?: string;
  imageLarge2xSrc?: string;
  imageLargeTallSrc?: string;
  imageLargeTall2xSrc?: string;
}

type MediaBucket = 'small' | 'medium' | 'mediumTall' | 'large' | 'largeTall';

/** Which breakpoint bucket a media query belongs to. */
function mediaBucket(media: string): MediaBucket {
  if (/\(max-width:\s*734px\)/.test(media)) return 'small';
  if (/\(max-width:\s*1068px\)/.test(media)) {
    return /\(min-height:\s*734px\)/.test(media) ? 'mediumTall' : 'medium';
  }
  return /\(min-height:\s*776px\)/.test(media) ? 'largeTall' : 'large';
}

/**
 * Merge per-size image uploads onto an art-directed PictureData. Each size
 * slot replaces only the sources in its bucket (with fallbacks to sibling
 * variants when a tall/optional slot is left blank); completely unset
 * overrides keep the originals untouched.
 */
export function applyResponsiveImage(
  base: PictureData | null,
  o: ResponsiveImageOverride | undefined,
): PictureData | null {
  if (!o) return base;
  const byBucket: Record<MediaBucket, { src?: string; src2x?: string }> = {
    small: {
      src: o.imageSmallSrc || o.imageSquareSrc || undefined,
      src2x: o.imageSmall2xSrc || undefined,
    },
    medium: {
      src: o.imageMediumSrc || o.imageCompactSrc || undefined,
      src2x: o.imageMedium2xSrc || undefined,
    },
    mediumTall: {
      src: o.imageMediumTallSrc || o.imageMediumTall2xSrc || o.imageMediumSrc || o.imageCompactSrc || undefined,
      src2x: o.imageMediumTall2xSrc || o.imageMedium2xSrc || undefined,
    },
    large: {
      src: o.imageLargeSrc || undefined,
      src2x: o.imageLarge2xSrc || undefined,
    },
    largeTall: {
      src: o.imageLargeTallSrc || o.imageLargeSrc || o.imageLargeTall2xSrc || undefined,
      src2x: o.imageLargeTall2xSrc || o.imageLarge2xSrc || undefined,
    },
  };
  // The legacy single-src field replaces every bucket's 1x slot (and 2x when
  // nothing more specific is given) — the "one image everywhere" shortcut.
  const anyBucketSet =
    Object.values(byBucket).some((b) => b.src || b.src2x) ||
    Boolean(o.imageSquareSrc || o.imageCompactSrc);
  if (!anyBucketSet && !o.imageSrc) return base;

  if (!base) {
    // No original picture (shouldn't happen for tiles, but be safe).
    const src =
      o.imageSrc ??
      o.imageLargeTallSrc ??
      o.imageLargeSrc ??
      o.imageMediumSrc ??
      o.imageCompactSrc ??
      o.imageSmallSrc ??
      o.imageSquareSrc ??
      '';
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
    o.imageLargeTallSrc ||
    o.imageLargeSrc ||
    o.imageSrc ||
    o.imageMediumSrc ||
    o.imageMediumTallSrc ||
    o.imageMediumTall2xSrc ||
    o.imageLargeTall2xSrc ||
    o.imageCompactSrc ||
    o.imageSmallSrc ||
    o.imageSquareSrc ||
    base.img.src;
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

export interface NavLinkOverride {
  label?: string;
  href?: string;
}

export interface NavLabelsOverride {
  items?: NavLinkOverride[];
  secondaryLinks?: NavLinkOverride[];
  promoText?: string;
  promoHref?: string;
  searchPlaceholder?: string;
}

export function mergeNavItems(
  items: NavItem[],
  override: NavLabelsOverride | undefined,
): NavItem[] {
  const overrides = override?.items;
  if (!overrides) return items;
  // Override array length wins: extras become text-label nav items, and any
  // built-in item whose href was changed by the admin becomes a direct link
  // rather than opening the old built-in mega menu.
  return overrides
    .map((o, i) => {
      const item = items[i];
      if (!item) {
        const label = o?.label?.trim() ?? '';
        if (!label) return null;
        return {
          key: `admin-item-${i}`,
          label,
          href: o?.href?.trim() || '/',
          ariaLabel: label,
          wordmark: { viewBox: '0 0 1 1', width: 1, height: 1, paths: [] },
        };
      }
      if (!o) return item;
      const nextLabel = o.label !== undefined ? o.label.trim() : item.label;
      if (!nextLabel) return null;
      const nextHref = o.href !== undefined ? o.href.trim() || item.href : item.href;
      const hrefCustomized = o.href !== undefined && nextHref !== item.href;
      return {
        ...item,
        key: hrefCustomized ? `custom-nav-${i}` : item.key,
        label: nextLabel,
        href: nextHref,
        ariaLabel: nextLabel,
      };
    })
    .filter((entry): entry is NavItem => entry !== null);
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


/* --------------------------------------------------- Gadzio New UI overrides */

export interface TrustBadgeItemOverride {
  title?: string;
  subtitle?: string;
  icon?: string;
  href?: string;
}

export interface TrustBarOverride {
  enabled?: boolean;
  items?: TrustBadgeItemOverride[];
}

export interface CategoryGridItemOverride {
  title?: string;
  subtitle?: string;
  image?: string;
  href?: string;
  badge?: string;
}

export interface CategoryGridOverride {
  heading?: string;
  enabled?: boolean;
  items?: CategoryGridItemOverride[];
}

export interface CrowdFavoriteItemOverride {
  unavailable?: boolean;
  priceDisplay?: string;
  title?: string;
  price?: string;
  image?: string;
  href?: string;
  badge?: string;
  badgeColor?: 'lavender' | 'yellow' | 'green' | 'default';
  secondaryBadge?: string;
  secondaryBadgeColor?: 'pink' | 'yellow' | 'green' | 'default';
  colorDots?: string;
}

export interface CrowdFavoritesOverride {
  heading?: string;
  subtitle?: string;
  rightLinkLabel?: string;
  rightLinkHref?: string;
  enabled?: boolean;
  items?: CrowdFavoriteItemOverride[];
}

export interface EventBannerOverride {
  heading?: string;
  subtitle?: string;
  ctaLabel?: string;
  ctaHref?: string;
  image?: string;
  enabled?: boolean;
}



export interface BrandLogoItemOverride {
  name?: string;
  subhead?: string;
  href?: string;
}

export interface BrandBarOverride {
  enabled?: boolean;
  items?: BrandLogoItemOverride[];
}

export interface FestiveProductItemOverride {
  unavailable?: boolean;
  title?: string;
  tagPrimary?: string;
  tagSecondary?: string;
  amountText?: string;
  originalAmountText?: string;
  savingsText?: string;
  image?: string;
  href?: string;
}

export interface DiwaliCampaignOverride {
  enabled?: boolean;
  bannerKicker?: string;
  bannerTitle?: string;
  bannerButtonLabel?: string;
  bannerButtonHref?: string;
  bannerImage?: string;
  items?: FestiveProductItemOverride[];
}

export interface ReviewItemOverride {
  headline?: string;
  rating?: string | number;
  content?: string;
  author?: string;
  badgeText?: string;
}

export interface ReviewsOverride {
  enabled?: boolean;
  kicker?: string;
  heading?: string;
  subheading?: string;
  items?: ReviewItemOverride[];
}

export interface WildPhotoItemOverride {
  image?: string;
  alt?: string;
  caption?: string;
  href?: string;
}

export interface InTheWildOverride {
  enabled?: boolean;
  heading?: string;
  subheading?: string;
  items?: WildPhotoItemOverride[];
}

