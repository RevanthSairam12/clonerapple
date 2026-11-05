/**
 * What an order line sold, as it was sold.
 *
 * Order rows created before the option snapshot columns (migration 0061) only
 * carry `variantLabel`; every helper here falls back to it so old orders keep
 * rendering unchanged and are never rewritten.
 */

export interface OrderOptionSnapshot {
  deviceModelName?: string | null;
  colourName?: string | null;
  colourHex?: string | null;
  variantLabel?: string | null;
  variantSku?: string | null;
  imageUrl?: string | null;
  imageAlt?: string | null;
}

export interface OptionSnapshotColour {
  name: string;
  hex: string | null;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** "iPhone 16 · Red", or the stored variant label for older orders. */
export function optionSnapshotLabel(snapshot: OrderOptionSnapshot): string | null {
  const parts = [clean(snapshot.deviceModelName), clean(snapshot.colourName)].filter(Boolean);
  if (parts.length > 0) return parts.join(' · ');
  return clean(snapshot.variantLabel) || null;
}

export function optionSnapshotColour(snapshot: OrderOptionSnapshot): OptionSnapshotColour | null {
  const name = clean(snapshot.colourName);
  if (!name) return null;
  const hex = clean(snapshot.colourHex);
  return { name, hex: /^#[0-9a-f]{6}$/i.test(hex) ? hex.toUpperCase() : null };
}

/**
 * The photo the customer saw, snapshot first, catalogue fallback second.
 * Returns null when neither exists (a legacy line with no image).
 */
export function optionSnapshotImage(
  snapshot: OrderOptionSnapshot,
  fallbackUrl: string | null | undefined,
  fallbackAlt: string,
): { url: string; alt: string } | null {
  const url = clean(snapshot.imageUrl) || clean(fallbackUrl);
  if (!url) return null;
  return { url, alt: clean(snapshot.imageAlt) || clean(snapshot.variantLabel) || fallbackAlt };
}
