'use client';

import { useCallback, useEffect, useState } from 'react';

import { cn } from '@/lib/utils';

import { APPLE_LOGO, NAV_ITEMS, NAV_MENUS, SEARCH_PANEL, type NavWordmark } from './data/nav';
import { BagIcon, DrawerBackIcon, DrawerChevronIcon, SearchIcon } from './icons';
import { NavFlyoutGroups } from './NavFlyoutGroups';
import { NavSearchPanel } from './NavSearchPanel';

const NAV_HEIGHT_DESKTOP = 44;
const SEARCH_KEY = '__search__';

function Wordmark({ mark, className }: { mark: NavWordmark; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width={mark.width}
      height={mark.height}
      viewBox={mark.viewBox}
      xmlns="http://www.w3.org/2000/svg"
    >
      {mark.paths.map((d) => (
        <path key={d.slice(0, 24)} d={d} fill="currentColor" />
      ))}
    </svg>
  );
}

/**
 * `nav#globalnav` — fixed translucent bar with click-driven flyouts.
 *
 * INTERACTION MODEL: **click-driven**, verified against the live page — hovering
 * a product item (link or trigger button) never opens its flyout, even after a
 * 1.6s dwell; `button.globalnav-submenu-trigger-button.click()` does (nav gains
 * `globalnav-with-flyout-open globalnav-with-submenu-open`, panel height
 * animates over 254ms, curtain fades in over 320ms). Below 834px the bar shows a
 * hamburger that expands the whole nav into a full-height drawer.
 */
export function GlobalNav({ bannerVisible }: { bannerVisible: boolean }) {
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMenu, setDrawerMenu] = useState<string | null>(null);

  const closeAll = useCallback(() => {
    setActiveMenu(null);
    setDrawerOpen(false);
    setDrawerMenu(null);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeAll();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeAll]);

  const openMenu = activeMenu ? NAV_MENUS.find((menu) => menu.key === activeMenu) : undefined;
  const panelHeight =
    activeMenu === SEARCH_KEY
      ? SEARCH_PANEL.heightPx - NAV_HEIGHT_DESKTOP
      : openMenu
        ? openMenu.heightPx - NAV_HEIGHT_DESKTOP
        : 0;

  const flyoutOpen = activeMenu !== null;
  const curtainOpen = flyoutOpen || drawerOpen;
  const drawerSubmenu = drawerMenu ? NAV_MENUS.find((menu) => menu.key === drawerMenu) : undefined;

  return (
    <>
      <nav
        id="globalnav"
        aria-label="Global"
        data-menu-open={drawerOpen}
        className={cn(
          'fixed inset-x-0 z-9999 h-[48px] anav:h-[44px]',
          '[backdrop-filter:saturate(1.8)_blur(20px)]',
          bannerVisible ? 'top-[135px] anav:top-[70px]' : 'top-0',
        )}
      >
        {/* .globalnav-content — becomes the drawer surface below 834px */}
        <div
          className={cn(
            'ac-drawer-content absolute inset-x-0 top-0 anav:static anav:mx-auto anav:max-w-[1024px] anav:px-[22px]',
            drawerOpen ? 'h-dvh overflow-y-auto bg-[#fafafc]' : 'h-[48px] bg-[rgba(255,255,255,0.8)]',
            'anav:h-[44px] anav:overflow-visible',
            flyoutOpen ? 'anav:bg-[#fafafc]' : 'anav:bg-transparent',
          )}
        >
          {/* the bar itself */}
          <ul className="flex h-[48px] justify-between pr-[48px] anav:-mx-[8px] anav:h-[44px] anav:pr-0">
            <li className={cn('grow anav:grow-0', drawerOpen && 'invisible anav:visible')}>
              <a
                href={APPLE_LOGO.href}
                aria-label={APPLE_LOGO.label}
                className="ac-nav-link flex h-[48px] items-center px-[16px] anav:h-[44px] anav:px-[8px]"
              >
                <Wordmark mark={APPLE_LOGO.compact} className="anav:hidden" />
                <Wordmark mark={APPLE_LOGO.regular} className="hidden anav:block" />
              </a>
            </li>

            {/* product items — desktop only */}
            {NAV_ITEMS.map((item) => {
              const isOpen = activeMenu === item.key;
              return (
                <li key={item.key} className="hidden anav:block">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={`globalnav-submenu-${item.key}`}
                    aria-label={item.ariaLabel}
                    onClick={() => setActiveMenu(isOpen ? null : item.key)}
                    className="ac-nav-link flex h-[44px] cursor-pointer items-center px-[8px]"
                  >
                    <Wordmark mark={item.wordmark} />
                  </button>
                </li>
              );
            })}

            <li className={cn('anav:shrink-0', drawerOpen && 'invisible anav:visible')}>
              <button
                type="button"
                aria-label={SEARCH_PANEL.placeholder}
                aria-expanded={activeMenu === SEARCH_KEY}
                aria-controls="globalnav-submenu-search"
                onClick={() => setActiveMenu(activeMenu === SEARCH_KEY ? null : SEARCH_KEY)}
                className="ac-nav-link flex h-[48px] w-[48px] cursor-pointer items-center justify-center anav:h-[44px] anav:w-auto anav:px-[8px]"
              >
                <SearchIcon />
              </button>
            </li>

            <li className={cn('anav:shrink-0', drawerOpen && 'invisible anav:visible')}>
              <a
                href="/us/shop/goto/bag"
                aria-label="Shopping Bag"
                className="ac-nav-link flex h-[48px] w-[48px] items-center justify-center anav:h-[44px] anav:w-auto anav:px-[8px]"
              >
                <BagIcon />
              </a>
            </li>
          </ul>

          {/* mobile drawer contents */}
          {drawerOpen ? (
            <div className="anav:hidden">
              {drawerSubmenu ? (
                <div className="px-[48px] pt-[2px]">
                  {drawerSubmenu.groups.map((group, groupIndex) => (
                    <div key={group.region || group.heading} className="pb-[52px] last:pb-[92px]">
                      {groupIndex > 0 ? (
                        <h2 className="text-[17px] leading-[21px] text-[#6e6e73]">{group.heading}</h2>
                      ) : null}
                      <ul>
                        {group.links.map((link) => (
                          <li key={`${link.label}|${link.href}`} className="-mx-[11px]">
                            <a
                              href={link.href}
                              aria-label={link.ariaLabel}
                              className={cn(
                                'ac-submenu-link mb-[-6px] inline-block',
                                link.elevated
                                  ? 'p-[11px] text-[28px] leading-[32px] font-semibold'
                                  : 'px-[11px] pt-[8px] pb-[7px] text-[17px] leading-[25px] font-semibold',
                              )}
                              style={link.elevated ? { fontFamily: 'var(--ac-font-display)' } : undefined}
                            >
                              {link.label}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : (
                <ul className="pb-[84px]">
                  {NAV_ITEMS.map((item, i) => (
                    <li key={item.key} className={cn('block', i === 0 && '-mt-[3px]')}>
                      <button
                        type="button"
                        onClick={() => setDrawerMenu(item.key)}
                        className="ac-drawer-row flex h-[46px] w-full cursor-pointer items-start justify-between px-[48px] pt-[3px] pb-[4px] text-left"
                      >
                        {item.label}
                        <span className="-mr-[48px] flex h-[47px] w-[9px] scale-80 items-center pr-[19px] text-[#333336]">
                          <DrawerChevronIcon />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {/* hamburger / close */}
          <button
            type="button"
            aria-label={drawerOpen ? 'Close Menu' : 'Menu'}
            aria-expanded={drawerOpen}
            onClick={() => {
              setDrawerOpen((open) => !open);
              setDrawerMenu(null);
            }}
            className="absolute top-0 right-0 z-3 size-[48px] cursor-pointer anav:hidden"
          >
            <span className="ac-menutrigger-bread ac-menutrigger-bread-top" />
            <span className="ac-menutrigger-bread ac-menutrigger-bread-bottom" />
          </button>

          {/* back chevron, shown while a mobile submenu is open */}
          <button
            type="button"
            aria-label="Main menu"
            onClick={() => setDrawerMenu(null)}
            className={cn(
              'ac-drawer-back absolute top-0 left-0 z-3 flex size-[48px] cursor-pointer items-center justify-center text-[#333336] anav:hidden',
              drawerMenu ? 'visible opacity-100' : 'invisible scale-80 opacity-0',
            )}
          >
            <DrawerBackIcon />
          </button>
        </div>

        {/* desktop flyout panel */}
        <div
          id={activeMenu === SEARCH_KEY ? 'globalnav-submenu-search' : `globalnav-submenu-${activeMenu ?? 'none'}`}
          className={cn(
            'ac-flyout absolute inset-x-0 top-full hidden bg-[#fafafc] anav:block',
            flyoutOpen ? 'visible' : 'invisible',
          )}
          style={{ height: `${panelHeight}px` }}
        >
          {activeMenu === SEARCH_KEY ? <NavSearchPanel /> : openMenu ? <NavFlyoutGroups menu={openMenu} /> : null}
        </div>
      </nav>

      {/* #globalnav-curtain */}
      <div
        id="globalnav-curtain"
        aria-hidden="true"
        data-open={curtainOpen}
        onClick={closeAll}
        className={cn(
          'ac-curtain fixed inset-0 z-9998',
          curtainOpen ? 'visible opacity-100' : 'invisible opacity-0',
        )}
      />
    </>
  );
}
