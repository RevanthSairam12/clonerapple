'use client';

import { useEffect, useRef, useState } from 'react';

/** Convert a relative Apple path to a full URL so links navigate correctly. */
const appleUrl = (href: string) =>
  href.startsWith('http') ? href : `https://www.apple.com${href}`;

import { cn } from '@/lib/utils';

import { ArtDirectedPicture } from './ArtDirectedPicture';
import { FAM_GALLERY_ITEMS, GALLERY_META, TV_GALLERY_ITEMS, type GalleryItem } from './data/gallery';
import { GALLERY_LOGOS, GalleryPauseIcon, GalleryPlayIcon } from './icons';
import { applyResponsiveImage, type GalleryItemOverride, type GalleryOverride } from './admin-overrides';

/** Merge admin overrides onto gallery items (captions + background art). */
function mergeGalleryItems(
  items: GalleryItem[],
  overrides: GalleryItemOverride[] | undefined,
): GalleryItem[] {
  if (!overrides) return items;
  // Override array length wins — an added card clones the last one (its art
  // stays; the editor can change its caption or upload new art).
  return overrides.map((o, i) => {
    const item = items[i] ?? items[items.length - 1];
    const caption = o?.title;
    const background = applyResponsiveImage(item.background, o);
    const withCaption = caption === undefined || !caption ? item : { ...item, caption };
    return background === item.background ? withCaption : { ...withCaption, background };
  });
}

function CardShell({
  item,
  active,
  offset,
  onSelect,
  children,
  className,
  mounted,
}: {
  item: GalleryItem;
  active: boolean;
  offset: number;
  onSelect?: () => void;
  children: React.ReactNode;
  className?: string;
  mounted?: boolean;
}) {
  const liRef = useRef<HTMLLIElement>(null);
  const prevOffsetRef = useRef(offset);

  // Issue 1: Fix wrapping glitch
  // If offset jumped by >= 3 (e.g. from -4 to +4 when wrapping around),
  // immediately disable transition so the card teleports outside the viewport
  // instead of flying across the screen in reverse.
  const isWrapJump = Math.abs(offset - prevOffsetRef.current) >= 3;

  useEffect(() => {
    prevOffsetRef.current = offset;
    if (isWrapJump && liRef.current) {
      const el = liRef.current;
      const raf = requestAnimationFrame(() => {
        el.style.transition = '';
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [offset, isWrapJump]);

  // Issue 2: Fix cutoff edges
  // Show items up to offset ±3 so wide displays (>1440px) are fully populated without blank voids
  const isVisible = Math.abs(offset) <= 3;

  // Issue 3: Fix side card behavior
  // Clicking peeked cards scrolls them into focus instead of opening external link
  const handleClick = (e: React.MouseEvent) => {
    if (!active) {
      e.preventDefault();
      e.stopPropagation();
      onSelect?.();
    }
  };

  // Progressive depth opacity fade towards edges
  const absOffset = Math.abs(offset);
  const opacity = active ? 1 : absOffset === 1 ? 0.65 : absOffset === 2 ? 0.35 : 0.15;
  const zIndex = active ? 10 : Math.max(1, 5 - absOffset);

  return (
    <li
      ref={liRef}
      id={item.id}
      role="tabpanel"
      aria-hidden={!active}
      className={cn(
        'absolute inset-0 flex justify-center',
        mounted && !isWrapJump && 'ac-gallery-track'
      )}
      style={{
        transform: `translateX(${offset * 100}%)`,
        transition: isWrapJump ? 'none' : undefined,
        visibility: isVisible ? 'visible' : 'hidden',
        opacity: isVisible ? opacity : 0,
        zIndex,
      }}
    >
      <a
        href={appleUrl(item.href)}
        aria-label={active ? item.ariaLabel : `View ${item.caption || item.ariaLabel}`}
        tabIndex={active ? 0 : -1}
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleClick}
        className={cn(
          'relative block overflow-hidden bg-black transition-opacity duration-300',
          !active && 'cursor-pointer hover:opacity-90',
          className
        )}
      >
        {children}
      </a>
    </li>
  );
}

/** Large Apple TV card: art + radial scrim + pill and caption along the bottom. */
function TvCard({
  item,
  active,
  offset,
  mounted,
  onSelect,
}: {
  item: GalleryItem;
  active: boolean;
  offset: number;
  mounted: boolean;
  onSelect: () => void;
}) {
  return (
    <CardShell
      item={item}
      active={active}
      offset={offset}
      mounted={mounted}
      onSelect={onSelect}
      className="h-full w-[275px] am:w-[688px] al:w-[930px]"
    >
      {item.background ? (
        <ArtDirectedPicture
          data={item.background}
          className="block h-full w-full"
          imgClassName="absolute inset-0 h-full w-full max-w-none object-cover"
        />
      ) : null}
      <div className="ac-gallery-scrim-large absolute inset-0 flex flex-col justify-end">
        {/* below 735px the card stacks the Apple TV+ badge over the show's logo */}
        <div className="absolute inset-x-0 top-0 flex flex-col items-center am:hidden">
          {item.atvLogo ? (
            <ArtDirectedPicture
              data={item.atvLogo}
              className="mt-[20px] mb-[5px] block"
              imgClassName="mx-auto block h-[32px] w-auto max-w-none object-contain"
            />
          ) : null}
          {item.showLogo ? (
            <ArtDirectedPicture
              data={item.showLogo}
              className="block"
              imgClassName="mx-auto block h-[40px] w-auto max-w-none object-contain"
            />
          ) : null}
        </div>
        {/* below 735px the caption and pill centre-stack; above it they sit in a row */}
        <div className="ac-gallery-bottom-content mt-auto flex flex-col-reverse items-center justify-center px-[15px] pb-[30px] am:flex-row am:justify-start am:px-[43px] am:pb-[34px] al:px-[48px] al:pb-[40px]">
          <div className="ac-button ac-button-neutral ac-button-small ac-button-gallery-tv mt-[13px] shrink-0 am:mt-0">
            {item.buttonLabel}
          </div>
          <p className="text-center text-[17px] leading-[21.0012px] tracking-[-0.374px] text-[#f5f5f7] am:pl-[18px] am:text-left al:text-[21px] al:leading-[25px] al:tracking-[0.231px]">
            {item.genre ? <span className="ac-gallery-genre font-bold">{item.genre}</span> : null}
            {item.caption}
          </p>
        </div>
      </div>
    </CardShell>
  );
}

/**
 * Small card: Music (square art + title), Arcade / Fitness+ (full-bleed art).
 *
 * The layout flips at 1069px, which the target does with the same markup:
 * below it the art, logo, caption and pill are all centre-stacked
 * (`bg-wrapper: column`, `bottom-content: column-reverse`, logo centred with a
 * 13px top margin); above it the art sits left of the caption and the pill moves
 * to the right of the bottom row with the logo in the top-right corner.
 */
function FamCard({
  item,
  active,
  offset,
  mounted,
  onSelect,
}: {
  item: GalleryItem;
  active: boolean;
  offset: number;
  mounted: boolean;
  onSelect: () => void;
}) {
  const logo = item.logo ? GALLERY_LOGOS[item.logo] : null;

  return (
    <CardShell
      item={item}
      active={active}
      offset={offset}
      mounted={mounted}
      onSelect={onSelect}
      className="h-full w-[188px] al:w-[417px]"
    >
      {item.musicLayout ? (
        <div className="absolute inset-0 flex flex-col items-center bg-black al:flex-row">
          {item.background ? (
            <ArtDirectedPicture
              data={item.background}
              className="relative z-4 mt-[46px] block size-[122px] shrink-0 overflow-hidden rounded-[8px] shadow-[rgba(0,0,0,0.22)_3px_5px_30px_0px] al:mt-0 al:ml-[19px] al:size-[196px]"
              imgClassName="block size-full max-w-none object-cover"
            />
          ) : null}
          {/* at >=1069px the title sits beside the artwork instead of in the bottom row */}
          <p className="relative z-3 ml-[19px] hidden w-[183px] overflow-hidden text-[14px] leading-[18.0008px] font-semibold tracking-[-0.224px] text-[#f5f5f7] al:block">
            {item.caption}
          </p>
        </div>
      ) : item.background ? (
        <ArtDirectedPicture
          data={item.background}
          className="block h-full w-full"
          imgClassName="absolute inset-0 h-full w-full max-w-none object-cover"
        />
      ) : null}

      <div className="ac-gallery-scrim-small absolute inset-0 flex flex-col justify-end">
        <div className="absolute inset-x-0 top-0 mt-[13px] flex justify-center al:mt-0 al:justify-end al:pt-[15px] al:pr-[15px]">
          {logo ? (
            <span className="block h-[14px] [&>svg]:h-[14px] [&>svg]:w-auto [&>svg]:fill-white">{logo}</span>
          ) : null}
        </div>
        <div className="ac-gallery-bottom-content flex flex-col-reverse items-center justify-center px-[30px] pb-[15px] am:px-[20px] al:flex-row-reverse al:justify-between al:pr-[15px] al:pb-[15px] al:pl-[19px]">
          <div className="ac-button ac-button-neutral ac-button-xsmall ac-button-gallery-fam shrink-0">
            {item.buttonLabel}
          </div>
          <p
            className={cn(
              'mb-[8px] line-clamp-2 overflow-hidden text-center text-[12px] leading-[16.0005px] font-semibold tracking-[-0.12px] text-[#f5f5f7]',
              'am:text-[14px] am:leading-[18.0008px] am:tracking-[-0.224px] al:mb-0 al:text-left',
              item.musicLayout && 'al:hidden',
            )}
          >
            {item.caption}
          </p>
        </div>
      </div>
    </CardShell>
  );
}

/**
 * `.section-endless-entertainment-gallery` — two carousels driven by one index.
 *
 * INTERACTION MODEL: time-driven with interactive controls.
 * Each item dwells 4.16s (`--sk-dotnav-timed-duration`) and the slide takes 650ms
 * with Apple's refined cubic-bezier curve.
 * Users can click dots, click side cards, swipe on touch, use arrow keys, or click
 * subtle navigation chevrons.
 */
export function EndlessEntertainmentGallery({ content }: { content?: GalleryOverride } = {}) {
  const tvItems = mergeGalleryItems(TV_GALLERY_ITEMS, content?.items);
  const count = tvItems.length;
  const secondRowEnabled = content?.secondRowEnabled !== false;

  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [dotWindow, setDotWindow] = useState(GALLERY_META.visibleDots);
  const [mounted, setMounted] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const apply = () => setDotWindow(window.matchMedia('(max-width: 480px)').matches ? 5 : GALLERY_META.visibleDots);
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, []);

  const goToPrev = () => setIndex((i) => (i - 1 + count) % count);
  const goToNext = () => setIndex((i) => (i + 1) % count);

  useEffect(() => {
    if (paused || hovered) return;
    timer.current = setTimeout(() => setIndex((i) => (i + 1) % count), GALLERY_META.itemDurationMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [index, paused, hovered, count]);

  // Keyboard navigation: Left/Right arrows
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') goToPrev();
      if (e.key === 'ArrowRight') goToNext();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [count]);

  // Touch swipe support
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const deltaX = e.changedTouches[0].clientX - touchStartX.current;
    const deltaY = e.changedTouches[0].clientY - (touchStartY.current ?? 0);
    if (Math.abs(deltaX) > 40 && Math.abs(deltaX) > Math.abs(deltaY)) {
      if (deltaX > 0) {
        goToPrev();
      } else {
        goToNext();
      }
    }
    touchStartX.current = null;
    touchStartY.current = null;
  };

  const half = Math.floor(dotWindow / 2);
  const start = Math.min(Math.max(0, index - half), Math.max(0, count - dotWindow));

  /** Wrap offset so items circulate instead of leaving gaps at edges. */
  const circularOffset = (i: number) => {
    const raw = ((i - index) % count + count) % count;
    return raw <= Math.floor(count / 2) ? raw : raw - count;
  };

  return (
    <section className={cn('bg-[#f5f5f7]', !GALLERY_META.headline && 'mt-[20px] al:mt-[30px]')}>
      <div className={cn('flex flex-col', GALLERY_META.headline && 'pt-[36px] al:pt-[53px]')}>
        {GALLERY_META.headline ? (
          <div className="mb-[17px] al:mb-[26px]">
            <h2
              className="text-center text-[32px] leading-[36px] font-semibold tracking-[0.128px] al:text-[56px] al:leading-[60px] al:tracking-[-0.28px]"
              style={{ fontFamily: 'var(--ac-font-display)' }}
            >
              {GALLERY_META.headline}
            </h2>
          </div>
        ) : null}

        {/* #tv-media-gallery */}
        <div
          className="group/gallery relative h-[496px] am:h-[367px] al:h-[523px] overflow-hidden select-none"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {/* Previous chevron */}
          <button
            type="button"
            onClick={goToPrev}
            aria-label="Previous slide"
            className="absolute left-3 top-1/2 -translate-y-1/2 z-30 hidden am:flex size-11 items-center justify-center rounded-full bg-[rgba(210,210,215,0.7)] text-black/70 backdrop-blur-md opacity-0 group-hover/gallery:opacity-100 transition-all hover:bg-[rgba(223,223,227,0.9)] hover:scale-105 active:scale-95 cursor-pointer shadow-md"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>

          {/* Next chevron */}
          <button
            type="button"
            onClick={goToNext}
            aria-label="Next slide"
            className="absolute right-3 top-1/2 -translate-y-1/2 z-30 hidden am:flex size-11 items-center justify-center rounded-full bg-[rgba(210,210,215,0.7)] text-black/70 backdrop-blur-md opacity-0 group-hover/gallery:opacity-100 transition-all hover:bg-[rgba(223,223,227,0.9)] hover:scale-105 active:scale-95 cursor-pointer shadow-md"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>

          <ul
            role="tablist"
            className="relative mx-auto h-full w-[288px] am:w-[701px] al:w-[943px]"
          >
            {tvItems.map((item, i) => (
              <TvCard
                key={item.id}
                item={item}
                active={i === index}
                offset={circularOffset(i)}
                mounted={mounted}
                onSelect={() => setIndex(i)}
              />
            ))}
          </ul>
        </div>

        {/* #fam-media-gallery */}
        {secondRowEnabled ? (
          <div
            className="relative box-content h-[254px] pt-[13px] al:h-[234px] overflow-hidden select-none"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            <ul className="relative mx-auto h-full w-[201px] al:w-[430px]">
              {FAM_GALLERY_ITEMS.map((item, i) => (
                <FamCard
                  key={item.id}
                  item={item}
                  active={i === index}
                  offset={circularOffset(i)}
                  mounted={mounted}
                  onSelect={() => setIndex(i)}
                />
              ))}
            </ul>
          </div>
        ) : null}

        {/* .media-gallery-dotnav */}
        <div className="relative my-[10px] flex h-[24px] justify-center am:my-[12px]">
          <ul role="tablist" className="flex justify-center">
            {tvItems.map((item, i) => {
              const visible = i >= start && i < start + dotWindow;
              const current = i === index;
              return (
                <li key={item.id} className={cn('block', !visible && 'w-0 overflow-hidden')}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={current}
                    aria-controls={item.id}
                    onClick={() => setIndex(i)}
                    data-current={current}
                    data-paused={paused || hovered}
                    className={cn('ac-dot', !visible && 'invisible')}
                    style={{ '--ac-dot-duration': `${GALLERY_META.itemDurationMs}ms` } as React.CSSProperties}
                  >
                    <span className="ac-visuallyhidden">Item {i + 1}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            aria-label={paused ? GALLERY_META.playLabel : GALLERY_META.pauseLabel}
            onClick={() => setPaused((p) => !p)}
            className="ac-dotnav-control absolute top-0 right-[10px] flex cursor-pointer items-center justify-center am:right-[12px]"
          >
            {paused ? <GalleryPlayIcon /> : <GalleryPauseIcon />}
          </button>
        </div>
      </div>
    </section>
  );
}
