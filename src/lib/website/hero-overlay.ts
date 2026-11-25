/**
 * Shared configuration, validation, and responsive geometry helpers for the
 * Store Admin → Website Editing → Hero Section Campaign Overlay (`gadzio.hero_overlay`).
 *
 * Pure module (no React or DB imports) so server routes, Store Admin previews,
 * client components, and tests share one exact source of truth.
 */

export const HERO_OVERLAY_COLLECTION_KEY = 'gadzio.hero_overlay';
export const HERO_OVERLAY_TARGET_ID = 'homepage-hero-tiles-new-ui';

export interface HeroCampaignOverlayConfig {
  enabled: boolean;
  tapeImage1: string;
  tapeImage2: string;
}

export const HERO_OVERLAY_DEFAULTS: HeroCampaignOverlayConfig = {
  enabled: false,
  tapeImage1: '',
  tapeImage2: '',
};

export interface HeroOverlayGeometry {
  diagonal: number;
  angleDeg: number;
  spanPx: number;
}

export interface OverlayImageDimensions {
  width: number;
  height: number;
}

/**
 * Only permit safe stored media paths (`/api/media/...`), single-slash site-relative
 * paths (`/images/...`), or explicit `http(s)://` URLs — never protocol-relative
 * (`//`), `javascript:`, or `data:` strings.
 */
export function isSafeOverlayImageUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('/api/media/')) return trimmed.length > '/api/media/'.length;
  if (trimmed.startsWith('/')) return !trimmed.startsWith('//');
  return /^https?:\/\/\S+$/i.test(trimmed);
}

/** Coerce any stored or partially edited value into a clean HeroCampaignOverlayConfig. */
export function normalizeHeroOverlayConfig(raw: unknown): HeroCampaignOverlayConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...HERO_OVERLAY_DEFAULTS };
  }
  const obj = raw as Record<string, unknown>;
  return {
    enabled: obj.enabled === true,
    tapeImage1: typeof obj.tapeImage1 === 'string' ? obj.tapeImage1.trim() : '',
    tapeImage2: typeof obj.tapeImage2 === 'string' ? obj.tapeImage2.trim() : '',
  };
}

/**
 * Validate Store Admin edits for `gadzio.hero_overlay`. Returns an actionable error
 * string or `null` when valid.
 */
export function validateHeroOverlayConfig(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return 'Hero overlay settings must be an object.';
  }
  const record = value as Record<string, unknown>;

  if (record.enabled !== undefined && typeof record.enabled !== 'boolean') {
    return 'Enable overlay must be true or false.';
  }
  if (record.tapeImage1 !== undefined && typeof record.tapeImage1 !== 'string') {
    return 'Tape image 1 must be a valid image path or URL.';
  }
  if (record.tapeImage2 !== undefined && typeof record.tapeImage2 !== 'string') {
    return 'Tape image 2 must be a valid image path or URL.';
  }

  const normalized = normalizeHeroOverlayConfig(record);

  if (normalized.tapeImage1 && !isSafeOverlayImageUrl(normalized.tapeImage1)) {
    return 'Tape image 1 must be an uploaded media URL or a valid https:// or relative image path.';
  }
  if (normalized.tapeImage2 && !isSafeOverlayImageUrl(normalized.tapeImage2)) {
    return 'Tape image 2 must be an uploaded media URL or a valid https:// or relative image path.';
  }

  if (normalized.enabled && (!normalized.tapeImage1 || !normalized.tapeImage2)) {
    return 'Upload both Tape image 1 and Tape image 2 before enabling the hero campaign overlay.';
  }

  return null;
}

/** Storefront defense-in-depth: render only when enabled AND both safe URLs exist. */
export function isHeroOverlayActive(raw: unknown): boolean {
  const config = normalizeHeroOverlayConfig(raw);
  return (
    config.enabled &&
    isSafeOverlayImageUrl(config.tapeImage1) &&
    isSafeOverlayImageUrl(config.tapeImage2)
  );
}

/**
 * Calculate container-relative X-overlay diagonal span and rotation angle.
 * Angle is measured from vertical so tall stacked mobile containers and wide
 * desktop 2-column grids both form a balanced corner-to-corner X without losing
 * legibility at extreme aspect ratios.
 */
export function computeHeroOverlayGeometry(width: number, height: number): HeroOverlayGeometry {
  if (!(width > 0) || !(height > 0)) {
    return { diagonal: 0, angleDeg: 45, spanPx: 0 };
  }
  const diagonal = Math.hypot(width, height);
  const rawAngleDeg = (Math.atan2(width, height) * 180) / Math.PI;
  const clampedAngleDeg = Math.min(66, Math.max(26, rawAngleDeg));
  const angleDeg = Math.round(clampedAngleDeg * 10) / 10;
  const spanPx = Math.ceil(diagonal * 1.08);
  return { diagonal, angleDeg, spanPx };
}

export interface TapeImageComputedStyle {
  position: 'absolute';
  top: '50%';
  left: '50%';
  width: string;
  height: string;
  maxWidth: 'none';
  maxHeight: 'none';
  transformOrigin: 'center center';
  transform: string;
}

/**
 * Compute inline positioning styles for one diagonal tape image centered on the
 * combined hero container while preserving its exact source aspect ratio.
 *
 * Vertical tape assets (`height >= width`) rotate `±angleDeg` from vertical with
 * `height: spanPx` and `width: 'auto'`. If a landscape asset is supplied, it
 * rotates so its long axis still follows the diagonal with `width: spanPx` and
 * `height: 'auto'`.
 */
export function computeTapeImageStyle(
  geometry: Pick<HeroOverlayGeometry, 'angleDeg' | 'spanPx'>,
  direction: 1 | -1,
  naturalSize?: OverlayImageDimensions | null,
): TapeImageComputedStyle {
  const isHorizontal = Boolean(
    naturalSize && naturalSize.width > 0 && naturalSize.height > 0 && naturalSize.width > naturalSize.height,
  );
  const rotationDeg = isHorizontal
    ? direction * (geometry.angleDeg - 90)
    : direction * geometry.angleDeg;

  return {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: isHorizontal ? `${geometry.spanPx}px` : 'auto',
    height: isHorizontal ? 'auto' : `${geometry.spanPx}px`,
    maxWidth: 'none',
    maxHeight: 'none',
    transformOrigin: 'center center',
    transform: `translate(-50%, -50%) rotate(${rotationDeg}deg)`,
  };
}
