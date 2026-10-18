/**
 * Allow-listed site fonts — the single source of truth shared by the root
 * layout (which loads them) and the admin Theme editor (which offers them).
 *
 * This module is deliberately plain data: it must NOT import `next/font`.
 * `collections.ts` is reachable from the admin panel's client components, and
 * pulling the font loaders into that graph would drag the loader runtime into
 * the client bundle. The loaders live in `./fontLoaders.ts` instead.
 *
 * Every name here has a matching loader in `fontLoaders.ts`, and every one is
 * self-hosted — see that file for the no-external-requests contract.
 */
export const DEFAULT_SITE_FONT = 'Inter';

/**
 * The faces an editor may pick. All are open-licence (OFL) families available
 * through Google's official font API, which `next/font` downloads at build
 * time and self-hosts. Order is the order shown in the admin dropdown.
 */
export const SITE_FONT_NAMES = [
  'Inter',
  'Roboto',
  'Montserrat',
  'Work Sans',
  'DM Sans',
] as const;

export type SiteFontName = (typeof SITE_FONT_NAMES)[number];

export function isSiteFontName(value: string): value is SiteFontName {
  return (SITE_FONT_NAMES as readonly string[]).includes(value);
}

/**
 * Resolve a stored `site_settings.fontFamily` value to an allow-listed face.
 *
 * Anything unrecognised falls back to the default rather than reaching the
 * network. Before the allow-list existed this value was interpolated straight
 * into a `fonts.googleapis.com` URL, so an arbitrary stored string became an
 * outbound request; now it can only ever select a face we already ship.
 */
export function resolveSiteFontName(value: string | undefined): SiteFontName {
  const cleaned = (value ?? '').replace(/['"]/g, '').trim();
  return isSiteFontName(cleaned) ? cleaned : DEFAULT_SITE_FONT;
}
