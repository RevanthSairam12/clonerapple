'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import { useCart } from '@/lib/cart/CartContext';
import {
  NAV_ITEMS,
  NAV_MENUS,
  SEARCH_PANEL,
  type FlyoutMenu,
  type NavItem,
} from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/data/nav';

/**
 * Sticky storefront header.
 *
 * LAYOUT: ported from mrbeast.store (see the `navs-container` / `nav-primary` /
 * `nav-mega` rules in their theme bundle). Where the old Apple-style nav was a
 * full-bleed translucent bar, this is a solid white bar floating on an 8px gap
 * with a flat 2px shadow and square bottom corners, a black announcement strip
 * above it, a centred uppercase nav, and a grey mega panel that drops out of it.
 *
 * Palette is deliberately NOT the Apple `--gz-blue`: the accent, hover fill,
 * flat shadow and cart badge come from the MrBeast theme (see `--gz-accent`,
 * `--gz-hover-fill`, `--gz-flat-shadow`, `--gz-badge` in gadzio.css).
 *
 * GEOMETRY: the bar is 48px inside a container with 8px top padding, so the
 * header is 56px at every breakpoint. The accessory pages pin a sticky sidebar
 * to `--cp-nav-height`; that variable must stay equal to --gz-nav-height.
 *
 * INTERACTION: hover-intent flyouts (140ms close delay so the pointer can
 * travel into the panel), click-to-toggle for coarse pointers, Escape and
 * outside-click to dismiss, and route changes always close everything.
 */
export interface GadzioHeaderProps {
  /** Shows the promo bar above the nav. */
  bannerVisible?: boolean;
  promoText?: string;
  promoHref?: string;
  /**
   * Nav items after admin overrides have been merged in. Defaults to the
   * generated Gadzio nav so the header also works standalone.
   */
  navItems?: NavItem[];
  searchPlaceholder?: string;
  /** Route for the account button. */
  accountHref?: string;
}

/* ------------------------------------------------------------------ icons */

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="10.5" cy="10.5" r="6.75" />
      <path d="M20 20l-4.4-4.4" />
    </svg>
  );
}

function AccountIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 21v-1.9a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4V21" />
      <circle cx="12" cy="7.2" r="3.9" />
    </svg>
  );
}

function BagIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5.6 7.4h12.8l1.1 12.1a1.6 1.6 0 0 1-1.6 1.7H6.1a1.6 1.6 0 0 1-1.6-1.7L5.6 7.4Z" />
      <path d="M8.9 9.6V6.4a3.1 3.1 0 0 1 6.2 0v3.2" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function CaretIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 4.5L6 7.5L9 4.5" />
    </svg>
  );
}

/** The Gadzio wordmark, with a text fallback if the asset cannot load. */
function GadzioWordmark() {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span className="text-[20px] leading-none font-bold tracking-[-0.03em] text-black">
        Gadzio
      </span>
    );
  }

  return (
    <img
      src="/gadzio_logo.png"
      alt="Gadzio"
      width={184}
      height={61}
      className="h-5 w-auto max-w-[104px] object-contain object-left select-none"
      onError={() => setFailed(true)}
    />
  );
}

/* --------------------------------------------------------- shared classes */

/** The MrBeast `nav-item-level-2` row: a 4px rule that lights up on hover. */
const COLUMN_LINK =
  'block border-b-4 border-transparent px-1 py-[7px] text-[14px] leading-tight font-medium text-[#1d1d1f] transition-colors duration-150 hover:border-[#00acd4]';

/** Showcase links — underline treatment from MrBeast's `nav-media-block-text`. */
const SHOWCASE_LINK =
  'block py-[5px] text-[16px] leading-tight font-semibold text-[#1d1d1f] decoration-[#00acd4] decoration-2 underline-offset-4 transition-colors duration-150 hover:underline';

/* ------------------------------------------------------------ mega panel */

function MegaColumn({
  heading,
  links,
  showcase,
}: {
  heading: string;
  links: FlyoutMenu['groups'][number]['links'];
  showcase: boolean;
}) {
  if (links.length === 0) return null;

  return (
    <div className="min-w-0">
      <h2
        className={
          showcase
            ? 'sr-only'
            : 'mb-1 text-[13px] leading-none font-semibold tracking-[0.02em] text-[#6e6e73] uppercase'
        }
      >
        {heading}
      </h2>
      <ul className={showcase ? 'space-y-1' : ''}>
        {links.map((link) => (
          <li key={`${link.label}|${link.href}`}>
            <Link
              href={link.href}
              aria-label={link.ariaLabel ?? link.label}
              className={showcase ? SHOWCASE_LINK : COLUMN_LINK}
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------ main header */

export function GadzioHeader({
  bannerVisible = false,
  promoText = 'Students save more with Gadzio Education pricing — explore the Education Store',
  promoHref = '/in-edu/store',
  navItems = NAV_ITEMS,
  searchPlaceholder = SEARCH_PANEL.placeholder,
  accountHref = '/auth',
}: GadzioHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { totalCount, badgeBouncing } = useCart();

  const [openKey, setOpenKey] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileKey, setMobileKey] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  /** Section whose links fill the secondary bar. Falls back to the first item,
      which is what the mrbeast header does (`x-init` activates item one). */
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  /** Delays closing on pointer-leave so the pointer can travel into the panel. */
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openMenu = openKey ? NAV_MENUS.find((menu) => menu.key === openKey) : undefined;
  const resolvedActiveKey = activeKey ?? navItems[0]?.key ?? null;
  const activeMenu = NAV_MENUS.find((menu) => menu.key === resolvedActiveKey);
  /** The menu's showcase column — the row that lands in the secondary bar. */
  const secondaryLinks = activeMenu?.groups[0]?.links ?? [];
  const anyPanelOpen = openMenu !== undefined || searchOpen || mobileOpen;

  const closeAll = useCallback(() => {
    setOpenKey(null);
    setSearchOpen(false);
    setMobileOpen(false);
    setMobileKey(null);
  }, []);

  /* --------------------------------------------------------- interactions */

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpenKey(null), 140);
  }, [cancelClose]);

  useEffect(() => cancelClose, [cancelClose]);

  // Escape closes whatever is open.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeAll();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeAll]);

  // A route change always dismisses the header's overlays.
  useEffect(() => {
    closeAll();
  }, [pathname, closeAll]);

  // Move focus into the search field when the panel opens.
  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  // Keep the page behind the mobile drawer from scrolling.
  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileOpen]);

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    closeAll();
    setQuery('');
    router.push(`/search?q=${encodeURIComponent(trimmed)}`);
  };

  // Dismiss the flyout once focus leaves the header entirely (keyboard users).
  const onHeaderBlur = (event: React.FocusEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setOpenKey(null);
    }
  };

  /* ----------------------------------------------------------------- view */

  return (
    <>
      {/* Announcement strip — black, 13px, weight 500, centred with an arrow. */}
      {bannerVisible && (
        <div className="w-full bg-black text-white">
          <div className="mx-auto flex max-w-[800px] items-center justify-center px-4">
            <Link
              href={promoHref}
              className="group inline-flex items-center gap-1.5 py-2 text-[13px] leading-none font-medium tracking-[-0.01em] transition-opacity duration-150 hover:opacity-80"
            >
              <span>{promoText}</span>
              <span
                aria-hidden="true"
                className="transition-transform duration-200 group-hover:translate-x-0.5"
              >
                &rarr;
              </span>
            </Link>
          </div>
        </div>
      )}

      <header
        className="gz-header sticky top-0 z-[900] w-full font-sans"
        onMouseLeave={scheduleClose}
        onBlur={onHeaderBlur}
      >
        {/* The 8px top gap is what makes the bar read as floating. It also
            means the panels cannot use `top-full` (that would clear the
            secondary bar too) — they hang from the bar's bottom edge via
            `--gz-bar-bottom` instead. */}
        <div className="relative mx-auto max-w-[1440px] px-2 pt-2 anav:px-4">
          <nav
            aria-label="Global"
            className="relative z-10 grid h-12 grid-cols-12 items-center rounded-sm bg-white px-2 shadow-[0_0_2px_0_#bbb] anav:rounded-b-none anav:px-4"
          >
            {/* Hamburger — morphs to an X, below `anav` only. */}
            <button
              type="button"
              aria-label={mobileOpen ? 'Close menu' : 'Menu'}
              aria-expanded={mobileOpen}
              aria-controls="gz-nav-mobile"
              onClick={() => {
                setMobileOpen((open) => !open);
                setMobileKey(null);
                setSearchOpen(false);
              }}
              className="col-span-2 flex cursor-pointer items-center p-2 text-black anav:hidden"
            >
              <span className="relative flex h-6 w-6 flex-col justify-between p-[3px]">
                <span
                  className={`block h-[2px] w-full rounded-sm bg-current transition-all duration-200 ${
                    mobileOpen ? 'absolute top-[11px] left-[3px] rotate-45' : ''
                  }`}
                />
                <span
                  className={`block h-[2px] w-full rounded-sm bg-current transition-all duration-200 ${
                    mobileOpen ? 'opacity-0' : 'opacity-100'
                  }`}
                />
                <span
                  className={`block h-[2px] w-full rounded-sm bg-current transition-all duration-200 ${
                    mobileOpen ? 'absolute top-[11px] left-[3px] -rotate-45' : ''
                  }`}
                />
              </span>
            </button>

            {/* Wordmark */}
            <div className="col-span-8 flex items-center justify-center anav:col-span-2 anav:justify-start">
              <Link
                href="/"
                aria-label="Gadzio"
                onClick={closeAll}
                className="flex items-center p-2 pb-1.5 transition-opacity duration-150 hover:opacity-70"
              >
                <GadzioWordmark />
              </Link>
            </div>

            {/* Primary nav — centred in the middle 8 columns. */}
            <ul className="col-span-8 hidden items-center justify-center gap-2 anav:flex">
              {navItems.map((item) => {
                const menu = NAV_MENUS.find((candidate) => candidate.key === item.key);
                const isOpen = openKey === item.key;

                if (!menu) {
                  return (
                    <li key={item.key}>
                      <Link
                        href={item.href}
                        aria-label={item.ariaLabel}
                        className="flex h-9 items-center justify-center rounded-full px-4 text-[14px] leading-none font-bold tracking-[-0.01em] text-black uppercase transition-colors duration-150 hover:bg-[#e8eaee]"
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                }

                return (
                  <li key={item.key}>
                    <button
                      type="button"
                      aria-label={item.ariaLabel}
                      aria-expanded={isOpen}
                      aria-controls="gz-nav-mega"
                      onMouseEnter={() => {
                        cancelClose();
                        setOpenKey(item.key);
                        setActiveKey(item.key);
                        setSearchOpen(false);
                      }}
                      onClick={() => {
                        cancelClose();
                        setOpenKey(isOpen ? null : item.key);
                        setActiveKey(item.key);
                        setSearchOpen(false);
                      }}
                      className={`flex h-9 cursor-pointer items-center justify-center gap-1 rounded-full px-4 text-[14px] leading-none font-bold tracking-[-0.01em] uppercase transition-colors duration-150 ${
                        isOpen ? 'bg-[#e8eaee] text-black' : 'text-black hover:bg-[#e8eaee]'
                      }`}
                    >
                      {item.label}
                    </button>
                  </li>
                );
              })}
            </ul>

            {/* Utilities — 18px glyphs in 42px square targets. */}
            <div className="col-span-2 flex items-center justify-end">
              <button
                type="button"
                aria-label={searchOpen ? 'Close search' : 'Search gadzio.com'}
                aria-expanded={searchOpen}
                aria-controls="gz-nav-search"
                onClick={() => {
                  setSearchOpen((open) => !open);
                  setOpenKey(null);
                  setMobileOpen(false);
                }}
                className="flex cursor-pointer items-center p-3 text-black transition-opacity duration-150 hover:opacity-60"
              >
                {searchOpen ? (
                  <CloseIcon className="h-[18px] w-[18px]" />
                ) : (
                  <SearchIcon className="h-[18px] w-[18px]" />
                )}
              </button>

              <Link
                href={accountHref}
                aria-label="Account"
                className="hidden items-center p-3 text-black transition-opacity duration-150 hover:opacity-60 anav:flex"
              >
                <AccountIcon className="h-[16px] w-[16px]" />
              </Link>

              <Link
                href="/cart"
                aria-label={
                  totalCount > 0 ? `Shopping bag with ${totalCount} items` : 'Shopping bag'
                }
                className="relative flex items-center p-3 text-black transition-opacity duration-150 hover:opacity-60"
              >
                <BagIcon className="h-[18px] w-[18px]" />
                {totalCount > 0 && (
                  <span
                    className={`pointer-events-none absolute right-0.5 bottom-2 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border border-black bg-[#ffe100] px-1 text-[10px] leading-none font-semibold text-black transition-transform duration-300 ${
                      badgeBouncing ? 'scale-125' : 'scale-100'
                    }`}
                  >
                    {totalCount}
                  </span>
                )}
              </Link>
            </div>
          </nav>

          {/* Outside-click catcher — no dim, matching the mrbeast panel which
              simply drops over the page. Sits under the bar and panels. */}
          {anyPanelOpen && (
            <div
              aria-hidden="true"
              onClick={closeAll}
              className="fixed inset-x-0 top-0 z-0 h-dvh"
            />
          )}

          {/* Mega panel — grey, flat shadow, rounded bottom only. */}
          {openMenu && (
            <div
              id="gz-nav-mega"
              className="gz-nav-panel absolute inset-x-2 top-(--gz-bar-bottom) z-20 rounded-b-sm bg-[#e8eaee] shadow-[0_0_2px_0_#bbb] anav:inset-x-4"
            >
              <div className="grid grid-cols-1 gap-x-10 gap-y-7 px-6 py-9 am:grid-cols-3 anav:px-10">
                {openMenu.groups.map((group, index) => (
                  <MegaColumn
                    key={group.region || group.heading}
                    heading={group.heading}
                    links={group.links}
                    // The first group is the menu's showcase column.
                    showcase={index === 0 || group.elevatedGroup}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Search panel */}
          {searchOpen && (
            <div
              id="gz-nav-search"
              className="gz-nav-panel absolute inset-x-2 top-(--gz-bar-bottom) z-20 rounded-b-sm bg-white shadow-[0_0_2px_0_#bbb] anav:inset-x-4"
            >
              <form
                onSubmit={submitSearch}
                role="search"
                className="flex items-center gap-3 px-6 py-5 anav:px-10"
              >
                <SearchIcon className="h-[18px] w-[18px] shrink-0 text-[#6e6e73]" />
                <input
                  ref={searchInputRef}
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={searchPlaceholder}
                  aria-label="Search"
                  className="min-w-0 flex-1 bg-transparent text-[15px] text-black outline-none placeholder:text-[#86868b]"
                />
                <button
                  type="submit"
                  className="shrink-0 cursor-pointer rounded-full bg-black px-4 py-2 text-[13px] leading-none font-bold tracking-[-0.01em] text-white uppercase transition-opacity duration-150 hover:opacity-80"
                >
                  Search
                </button>
              </form>
            </div>
          )}

          {/* Mobile drawer — grey-to-white, matching the mrbeast mobile panel. */}
          {mobileOpen && (
            <div
              id="gz-nav-mobile"
              className={`gz-nav-panel absolute inset-x-2 top-(--gz-bar-bottom) z-20 overflow-y-auto rounded-b-sm bg-linear-to-b from-[#e8eaee] to-white shadow-[0_0_2px_0_#bbb] anav:hidden ${
                // Cap to the viewport below the header — the nav bar is 56px,
                // plus the ~30px announcement strip when it is showing.
                bannerVisible
                  ? 'max-h-[calc(100dvh-86px)]'
                  : 'max-h-[calc(100dvh-56px)]'
              }`}
            >
              <ul className="bg-white">
                {navItems.map((item) => {
                  const menu = NAV_MENUS.find((candidate) => candidate.key === item.key);
                  const expanded = mobileKey === item.key;

                  if (!menu) {
                    return (
                      <li key={item.key}>
                        <Link
                          href={item.href}
                          onClick={closeAll}
                          className="flex h-[50px] items-center border-b border-white bg-[#e8eaee] px-4 text-[15px] font-bold tracking-[-0.01em] text-black uppercase"
                        >
                          {item.label}
                        </Link>
                      </li>
                    );
                  }

                  return (
                    <li key={item.key}>
                      <button
                        type="button"
                        aria-expanded={expanded}
                        aria-controls={`gz-nav-mobile-${item.key}`}
                        onClick={() => setMobileKey(expanded ? null : item.key)}
                        className="flex h-[50px] w-full cursor-pointer items-center justify-between border-b border-white bg-[#e8eaee] px-4 text-left text-[15px] font-bold tracking-[-0.01em] text-black uppercase"
                      >
                        {item.label}
                        <CaretIcon
                          className={`h-3 w-3 transition-transform duration-200 ${
                            expanded ? '-scale-y-100' : ''
                          }`}
                        />
                      </button>

                      {expanded && (
                        <div id={`gz-nav-mobile-${item.key}`} className="bg-white px-4 pb-6">
                          {menu.groups.map((group, index) => (
                            <div key={group.region || group.heading} className="pt-4">
                              <h3
                                className={
                                  index === 0 || group.elevatedGroup
                                    ? 'sr-only'
                                    : 'mb-1 text-[13px] leading-none font-semibold tracking-[0.02em] text-[#6e6e73] uppercase'
                                }
                              >
                                {group.heading}
                              </h3>
                              <ul>
                                {group.links.map((link) => (
                                  <li key={`${link.label}|${link.href}`}>
                                    <Link
                                      href={link.href}
                                      onClick={closeAll}
                                      aria-label={link.ariaLabel ?? link.label}
                                      className={
                                        index === 0 || group.elevatedGroup
                                          ? 'block border-b-4 border-transparent py-[7px] text-[16px] leading-tight font-semibold text-[#1d1d1f]'
                                          : 'block border-b-4 border-transparent py-[7px] text-[14px] leading-tight font-medium text-[#1d1d1f]'
                                      }
                                    >
                                      {link.label}
                                    </Link>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}

                <li>
                  <Link
                    href={accountHref}
                    onClick={closeAll}
                    className="flex h-[50px] items-center border-b border-white bg-[#e8eaee] px-4 text-[15px] font-bold tracking-[-0.01em] text-black uppercase"
                  >
                    Account
                  </Link>
                </li>
                <li>
                  <Link
                    href="/cart"
                    onClick={closeAll}
                    className="flex h-[50px] items-center justify-between bg-[#e8eaee] px-4 text-[15px] font-bold tracking-[-0.01em] text-black uppercase"
                  >
                    <span>Bag</span>
                    {totalCount > 0 && (
                      <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full border border-black bg-[#ffe100] px-1.5 text-[10px] leading-none font-semibold text-black">
                        {totalCount}
                      </span>
                    )}
                  </Link>
                </li>
              </ul>
            </div>
          )}

          {/* Secondary bar — the active section's showcase links, following the
              mrbeast `nav-secondary`: a 40px white strip directly under the bar
              with a hairline top border and square bottom corners. Desktop
              only; below `anav` these links live in the drawer instead. An open
              mega panel is layered over it. */}
          {secondaryLinks.length > 0 && (
            <div className="hidden h-10 border-t border-[#e8eaee] bg-white shadow-[0_0_2px_0_#bbb] anav:block">
              <ul className="flex h-full items-center justify-center gap-6 overflow-x-auto px-4">
                {secondaryLinks.map((link) => (
                  <li key={`${link.label}|${link.href}`} className="h-full shrink-0">
                    <Link
                      href={link.href}
                      aria-label={link.ariaLabel ?? link.label}
                      className="flex h-full items-center border-b-4 border-transparent text-[13px] leading-none font-medium whitespace-nowrap text-[#1d1d1f] transition-colors duration-150 hover:border-[#00acd4]"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </header>
    </>
  );
}
