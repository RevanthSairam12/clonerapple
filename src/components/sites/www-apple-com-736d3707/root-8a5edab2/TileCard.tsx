import type { CSSProperties, ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { ArtDirectedPicture } from './ArtDirectedPicture';
import type { SubheadSegment, Tile } from './data/tiles';

/** `none` keeps the cap unset at that breakpoint instead of inheriting a wider one. */
const px = (value: number | null) => (value === null ? 'none' : `${value}px`);

function Subhead({ segments }: { segments: SubheadSegment[] }) {
  return (
    <>
      {segments.map((segment, i) => {
        if (segment.kind === 'text') return segment.value;
        if (segment.kind === 'footnoteNumber') {
          return (
            <sup key={i} className="ac-footnote-number" aria-label={`Footnote ${segment.value}`}>
              {segment.value}
            </sup>
          );
        }
        return (
          <span key={i} className="ac-footnote-glyph" aria-label={`Footnote ${segment.value} symbol`}>
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
        'relative flex justify-center overflow-clip',
        isDark ? 'ac-theme-dark bg-black' : 'bg-[#f5f5f7]',
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
            imgStyle={{ objectPosition: isHero ? '50% 30%' : '50% 50%' }}
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
              'font-[family-name:var(--ac-font-display)] font-semibold',
              isHero
                ? 'text-[32px] leading-[36px] tracking-[0.064px] am:text-[48px] am:leading-[52.0077px] am:tracking-[-0.096px] al:text-[56px] al:leading-[60px] al:tracking-[-0.28px]'
                : 'text-[32px] leading-[36px] tracking-[0.064px] al:text-[40px] al:leading-[44px] al:tracking-normal',
              // logo headlines carry the target's optical nudge at every width
              tile.headlineLogo ? 'mt-[4px] mb-[-5px]' : null,
            )}
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
              'ac-tile-subhead mx-auto font-[family-name:var(--ac-font-display)] font-normal',
              isHero
                ? 'mt-[4px] text-[19px] leading-[23px] tracking-[0.228px] am:text-[24px] am:leading-[28px] am:tracking-[0.216px] al:mt-[6px] al:text-[28px] al:leading-[32px] al:tracking-[0.196px]'
                : 'text-[19px] leading-[23px] tracking-[0.228px] al:text-[21px] al:leading-[25px] al:tracking-[0.231px]',
              // text headlines need the gap the logo tiles get from their -5px
              !tile.headlineLogo ? (isHero ? null : 'mt-[4px] al:mt-[3px]') : null,
            )}
            style={
              {
                '--ac-subhead-sm': px(tile.subheadMaxWidth.sm),
                '--ac-subhead-md': px(tile.subheadMaxWidth.md),
                '--ac-subhead-lg': px(tile.subheadMaxWidth.lg),
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
          {tile.ctas.map((cta) => (
            <a
              key={`${cta.label}|${cta.href}`}
              href={cta.href}
              aria-label={cta.ariaLabel ?? undefined}
              className={cn(
                'ac-button relative z-4',
                cta.variant === 'secondary' && 'ac-button-secondary',
                // hero buttons are small below 735px; promo buttons are always small
                'ac-button-small',
                isHero && 'ac-button-hero',
              )}
            >
              {cta.label}
            </a>
          ))}
        </div>
      </div>

      {/* a.tile-link — covers the tile; the CTAs sit above it */}
      <a href={tile.href} className="absolute inset-0 z-3" aria-hidden="true" tabIndex={-1} />
    </div>
  );
}
