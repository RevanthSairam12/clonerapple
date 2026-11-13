/**
 * Client-safe Spin and Win colour, contrast, and rotation helpers.
 */

import { safeThemeColor } from '@/lib/website/theme-rules';

export const WHEEL_SEGMENT_PALETTE = [
  '#ffe100',
  '#111111',
  '#f3f4f6',
  '#fef3c7',
  '#e0f2fe',
  '#dcfce7',
  '#fce7f3',
  '#ede9fe',
] as const;

/** Parse #rgb, #rrggbb, or #rrggbbaa to sRGB [0..255] channels. */
function parseHexChannels(hex: string): [number, number, number] | null {
  const clean = safeThemeColor(hex);
  if (!clean) return null;
  const raw = clean.slice(1);
  if (raw.length === 3) {
    return [
      parseInt(raw[0] + raw[0], 16),
      parseInt(raw[1] + raw[1], 16),
      parseInt(raw[2] + raw[2], 16),
    ];
  }
  if (raw.length === 6 || raw.length === 8) {
    return [
      parseInt(raw.slice(0, 2), 16),
      parseInt(raw.slice(2, 4), 16),
      parseInt(raw.slice(4, 6), 16),
    ];
  }
  return null;
}

function linearizeChannel(channel255: number): number {
  const s = channel255 / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Choose #111111 or #ffffff for highest WCAG contrast on a hex background. */
export function contrastTextForHex(hex: string): '#111111' | '#ffffff' {
  const rgb = parseHexChannels(hex);
  if (!rgb) return '#111111';
  const lum =
    0.2126 * linearizeChannel(rgb[0])
    + 0.7152 * linearizeChannel(rgb[1])
    + 0.0722 * linearizeChannel(rgb[2]);
  const contrastWithBlack = (lum + 0.05) / (0.005 + 0.05);
  const contrastWithWhite = 1.05 / (lum + 0.05);
  return contrastWithBlack >= contrastWithWhite ? '#111111' : '#ffffff';
}

export function sanitizeHexColor(value: unknown, fallback = '#ffe100'): string {
  return safeThemeColor(value) ?? fallback;
}

/**
 * Compute target clockwise wheel rotation (degrees) so `segmentIndex` stops
 * centered under the 12 o'clock pointer after `extraTurns` full revolutions.
 */
export function computeTargetWheelRotation(
  currentDeg: number,
  segmentIndex: number,
  totalSegments: number,
  extraTurns = 5,
): number {
  if (totalSegments <= 0 || segmentIndex < 0 || segmentIndex >= totalSegments) {
    return currentDeg;
  }
  const sliceDeg = 360 / totalSegments;
  const targetMod = (360 - ((segmentIndex + 0.5) * sliceDeg)) % 360;
  const desiredMod = targetMod < 0 ? targetMod + 360 : targetMod;
  const currentMod = ((currentDeg % 360) + 360) % 360;
  const deltaMod = (desiredMod - currentMod + 360) % 360;
  return currentDeg + Math.max(0, extraTurns) * 360 + deltaMod;
}

