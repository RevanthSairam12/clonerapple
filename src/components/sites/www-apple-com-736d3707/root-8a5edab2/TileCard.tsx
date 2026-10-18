import type { CSSProperties, ReactNode } from 'react';

import Link from 'next/link';

import { cn } from '@/lib/utils';

import { ArtDirectedPicture } from './ArtDirectedPicture';
import { TileInfoTooltip } from './TileInfoTooltip';
import type { SubheadSegment, Tile } from './data/tiles';

/** `none` keeps the cap unset at that breakpoint instead of inheriting a wider one. */
const px = (value: number | null) => (value === null ? 'none' : `${value}px`);

/**
 * True for URLs that leave the site: an absolute URL with a scheme
 * (`https:`, `mailto:`, …) or a protocol-relative one (`//host/path`).
 *
 * Tile links are now used exactly as authored. Earlier revisions rewrote every
 * non-absolute href to `https://www.apple.com<path>`, so a Gadzio-relative href
 * silently became an Apple destination. That rewrite is gone: relative hrefs
 * stay relative (and so stay a Gadzio route), and an external URL is only ever
 * reached when one is explicitly authored — which the CMS can still do for a
 * legitimate third-party destination.
 */
const isExternalHref = (href: string) => /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//');

function Subhead({ segments }: { segments: SubheadSegment[] }) {
  return (
    <>
      {segments.map((segment, i) => {
        if (segment.kind === 'text') return segment.value;
        if (segment.kind === 'footnoteNumber') {
          return (
            <sup key={i} className="gz-footnote-number" aria-label={`Footnote ${segment.value}`}>
              {segment.value}
            </sup>
          );
        }
        return (
          <span key={i} className="gz-footnote-glyph" aria-label={`Footnote ${segment.value} symbol`}>
            {segment.value}
          </span>
        );
      })}
    </>
  );
}

interface TileCardProps {
  tile: Tile;
  /** Extra media layered inside the image wrapper (hero tile 1's video stage). */
  children?: ReactNode;
  /** First tile above the fold — load its art eagerly. */
  priority?: boolean;
}

/**
 * One `.tile-wrapper` from `.section-hero` / `.section-promo`.
 *
 * Layout comes straight from the extraction (see components/TileSections.spec.md):
 * a padded flex box that centres a fixed-height copy column, with the
 * art-directed background absolutely filling the tile underneath and a
 * full-bleed link on top of everything except the CTAs.
 */
export function TileCard({ tile, children, priority = false }: TileCardProps) {
  const isHero = tile.group === 'hero';
  const isDark = tile.theme === 'dark';
  const Headline = isHero ? 'h2' : 'h3';

  return (
    <div
      className={cn(
        'relative flex justify-center overflow-clip rounded-[0.01rem]',
        isDark ? 'gz-theme-dark bg-black' : (tile.index === 0 && isHero ? 'bg-white' : 'bg-[#f5f5f7]'),
        isHero
          ? 'min-h-[500px] pt-[39px] pb-[43px] am:min-h-[650px] am:pt-[61px] am:pb-[69px] al:min-h-[692px] al:pt-[56px] al:pb-[63px]'
          : 'min-h-[500px] pt-[39px] pb-[43px] am:min-h-[490px] am:pt-[44px] am:pb-[48px] al:min-h-[580px] al:pt-[53px] al:pb-[60px]',
      )}
    >
      {/* .tile-image-wrapper — absolute, painted below the copy */}
      <div className="absolute inset-0">
        {tile.image ? (
          <ArtDirectedPicture
            data={tile.image}
            imgClassName="absolute left-1/2 h-full w-auto max-w-none -translate-x-1/2 object-cover"
            imgStyle={{
              objectPosition: isHero
                ? (tile.index === 0 ? '50% 100%' : (tile.index === 1 ? '50% 50%' : '50% 30%'))
                : '50% 50%',
            }}
            fetchPriority={priority ? 'high' : undefined}
            loading={priority ? 'eager' : 'lazy'}
          />
        ) : null}
        {children}
      </div>

      {/* .tile-content */}
      <div className="relative flex flex-col items-center text-center">
        <div className={cn('relative z-2', isDark ? 'text-[#f5f5f7]' : 'text-[#1d1d1f]')}>
          <Headline
            className={cn(
              'font-[family-name:var(--gz-font-display)] font-semibold',
              isHero
                ? 'text-[32px] leading-[36px] tracking-[0.064px] am:text-[48px] am:leading-[52.0077px] am:tracking-[-0.096px] al:text-[56px] al:leading-[60px] al:tracking-[-0.28px]'
                : 'text-[32px] leading-[36px] tracking-[0.064px] al:text-[40px] al:leading-[44px] al:tracking-normal',
              // logo headlines carry the target's optical nudge at every width
              tile.headlineLogo ? 'mt-[4px] mb-[-5px]' : null,
            )}
            // Promo card headlines only — hero tiles keep --gz-font-display from the
            // class above. Adding this to the hero side is a one-line change (drop
            // the isHero guard) once that's wanted.
            style={
              isHero
                ? undefined
                : {
                    // DEACTIVATED (previous font) — kept for easy rollback:
                    // fontFamily: 'var(--gz-font-display)',
                    // ACTIVE — matches the hero headlines in GadzioHeroSection.tsx
                    fontFamily:
                      '"Impact", "Arial Black", system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
                  }
            }
          >
            {tile.headlineLogo ? (
              <ArtDirectedPicture
                data={tile.headlineLogo}
                className="block"
                imgClassName="mx-auto block h-auto w-auto max-w-none"
                intrinsic
              />
            ) : (
              tile.headline
            )}
          </Headline>

          <p
            className={cn(
              'gz-tile-subhead mx-auto font-normal',
              // Hero subheads keep --gz-font-display (Inter). Promo subheads use
              // Tailwind's default font-sans — the same stack the hero's eyebrow
              // labels inherit from GadzioHeroSection's root <section>.
              // DEACTIVATED (previous font, for both) — kept for easy rollback:
              //   'font-[family-name:var(--gz-font-display)]',
              isHero ? 'font-[family-name:var(--gz-font-display)]' : 'font-sans',
              isHero
                ? 'mt-[4px] text-[19px] leading-[23px] tracking-[0.228px] am:text-[24px] am:leading-[28px] am:tracking-[0.216px] al:mt-[6px] al:text-[28px] al:leading-[32px] al:tracking-[0.196px]'
                : 'text-[19px] leading-[23px] tracking-[0.228px] al:text-[21px] al:leading-[25px] al:tracking-[0.231px]',
              // text headlines need the gap the logo tiles get from their -5px
              !tile.headlineLogo ? (isHero ? null : 'mt-[4px] al:mt-[3px]') : null,
            )}
            style={
              {
                '--gz-subhead-sm': px(tile.subheadMaxWidth.sm),
                '--gz-subhead-md': px(tile.subheadMaxWidth.md),
                '--gz-subhead-lg': px(tile.subheadMaxWidth.lg),
              } as CSSProperties
            }
          >
            <Subhead segments={tile.subhead} />
          </p>
        </div>

        {/* .tile-ctas */}
        <div
          className={cn(
            'relative z-3 grid grid-flow-col auto-cols-max justify-center',
            isHero
              ? 'mt-[11px] gap-x-[14px] am:mt-[16px] am:gap-x-[17px] al:mt-[17px]'
              : 'mt-[11px] gap-x-[14px] am:mt-[12px]',
          )}
        >
          {tile.ctas.map((cta, i) => {
            const ctaClassName = cn(
              'gz-button relative z-4',
              cta.variant === 'secondary' && 'gz-button-secondary',
              // hero buttons are small below 735px; promo buttons are always small
              'gz-button-small',
              isHero && 'gz-button-hero',
            );
            return (
              <div key={`${cta.label}|${cta.href}`} className="relative inline-flex items-center">
                {cta.internal ? (
                  <Link
                    href={cta.href}
                    aria-label={cta.ariaLabel ?? undefined}
                    className={ctaClassName}
                  >
                    {cta.label}
                  </Link>
                ) : (
                  <a
                    href={cta.href}
                    aria-label={cta.ariaLabel ?? undefined}
                    {...(isExternalHref(cta.href)
                      ? { target: '_blank', rel: 'noopener noreferrer' }
                      : null)}
                    className={ctaClassName}
                  >
                    {cta.label}
                  </a>
                )}
                {/* Very small (i) icon nestled at the corner of the CTA button */}
                {i === 0 && tile.infoTooltip ? (
                  <TileInfoTooltip text={tile.infoTooltip} />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {/* a.tile-link — covers the tile; the CTAs sit above it */}
      {tile.internal ? (
        <Link
          href={tile.href}
          className="absolute inset-0 z-2"
          aria-hidden="true"
          tabIndex={-1}
        />
      ) : (
        <a
          href={tile.href}
          {...(isExternalHref(tile.href)
            ? { target: '_blank', rel: 'noopener noreferrer' }
            : null)}
          className="absolute inset-0 z-2"
          aria-hidden="true"
          tabIndex={-1}
        />
      )}
    </div>
  );
}
