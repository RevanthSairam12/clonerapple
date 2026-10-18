import { DM_Sans, Inter, Montserrat, Roboto, Work_Sans } from 'next/font/google';

import type { SiteFontName } from './fonts';

/**
 * Self-hosted font loaders — one per allow-listed face in `./fonts.ts`.
 *
 * `next/font` downloads each face at BUILD time and serves it from this app's
 * own `/_next/static/media/…` path, so the browser never contacts
 * `fonts.googleapis.com` or `fonts.gstatic.com`. That replaces the four
 * external `<link>` tags that used to sit in `src/app/layout.tsx` and the two
 * `@import url('https://fonts.googleapis.com/…')` rules in `cases.css` and
 * `accessory-category.css`.
 *
 * Notes on the options, since they are not interchangeable:
 *
 * - Every family here is a VARIABLE font, so `weight` is omitted. Passing it
 *   would pin the face to static instances and throw away the weight axis the
 *   existing CSS relies on (`font-weight: 300` … `900` across the site).
 * - `subsets` includes `latin-ext`, not just `latin`. Prices render in rupees
 *   (U+20B9), which Google's `latin` range excludes — dropping it would leave
 *   every "₹" to fall back to a system font and break the digits' metrics.
 * - All faces share the `--font-site` custom property, so `layout.tsx` applies
 *   the chosen face by putting ONE class on `<html>`. The global CSS tokens
 *   (`--gz-font-text/display/footer`, `--cp-font`) then read `var(--font-site)`
 *   and inherit it everywhere, with no per-font plumbing.
 * - `preload` is on for the default only. Five preloaded families would have
 *   every page fetch all five; the others use `display: 'swap'` plus the
 *   metric-matched fallback `next/font` generates automatically, which keeps
 *   the swap free of layout shift.
 *
 * The options below are repeated verbatim in each call rather than shared from
 * a constant: next/font statically analyses each call site and rejects both a
 * spread (`...OPTIONS`) and a call that is not a module-scope `const`. Only
 * `preload` actually differs between the five.
 */

export interface SiteFontLoader {
  /** Class that sets `font-family` directly — used by the admin previews. */
  className: string;
  /** Class that sets the `--font-site` custom property — used on `<html>`. */
  variable: string;
}

const inter = Inter({
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  variable: '--font-site',
  preload: true,
});
const roboto = Roboto({
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  variable: '--font-site',
  preload: false,
});
const montserrat = Montserrat({
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  variable: '--font-site',
  preload: false,
});
const workSans = Work_Sans({
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  variable: '--font-site',
  preload: false,
});
const dmSans = DM_Sans({
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  variable: '--font-site',
  preload: false,
});

export const FONT_LOADERS: Record<SiteFontName, SiteFontLoader> = {
  Inter: inter,
  Roboto: roboto,
  Montserrat: montserrat,
  'Work Sans': workSans,
  'DM Sans': dmSans,
};

/**
 * System stack appended after the self-hosted face. Mirrors what the site used
 * before, so a font that fails to download degrades to the same native UI font
 * rather than to the browser's serif default.
 */
export const FONT_FALLBACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Helvetica, Arial, sans-serif";
