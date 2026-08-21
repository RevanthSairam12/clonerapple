import { cn } from '@/lib/utils';

import type { FlyoutMenu } from './data/nav';

/**
 * The group columns inside an open desktop flyout.
 *
 * Measured (mac menu @1440): content `padding: 40px 22px 84px`, groups
 * `margin: 0 0 -4px` with `padding-right: 88px` (elevated) / `44px`; elevated
 * links 600 24px/28px with `padding: 9px 11px 7px` and `margin-bottom: -6px`;
 * small links 600 12px/16.0005px with `padding: 7px 11px`. List offsets below
 * the heading: 6px for the elevated list, 10px for the others, and the first
 * small item inside the elevated group gets 14px.
 */
export function NavFlyoutGroups({ menu }: { menu: FlyoutMenu }) {
  return (
    <div className="mx-auto flex max-w-[1024px] px-[22px] pt-[40px] pb-[84px]">
      {menu.groups.map((group) => {
        let seenSmall = false;
        return (
          <div
            key={group.region || group.heading}
            className={cn('mb-[-4px] block', group.elevatedGroup ? 'pr-[88px]' : 'pr-[44px]')}
          >
            <h2 className="text-[12px] leading-[16.0005px] tracking-[-0.12px] text-[#6e6e73]">
              {group.heading}
            </h2>
            <ul className={cn('block', group.elevatedGroup ? 'mt-[6px]' : 'mt-[10px]')}>
              {group.links.map((link, i) => {
                const firstSmallAfterElevated = !link.elevated && !seenSmall && group.elevatedGroup;
                if (!link.elevated) seenSmall = true;
                return (
                  <li
                    key={`${link.label}|${link.href}`}
                    className={cn(
                      '-mx-[11px] block',
                      firstSmallAfterElevated && 'mt-[14px]',
                      i === 0 && link.elevated && 'mt-[6px]',
                    )}
                  >
                    <a
                      href={link.href}
                      aria-label={link.ariaLabel}
                      className={cn(
                        'ac-submenu-link mb-[-6px] inline-block whitespace-nowrap',
                        link.elevated
                          ? 'px-[11px] pt-[9px] pb-[7px] text-[24px] leading-[28px] font-semibold tracking-[0.216px]'
                          : 'ac-submenu-link-small px-[11px] py-[7px] text-[12px] leading-[16.0005px] font-semibold tracking-[-0.12px]',
                      )}
                      style={link.elevated ? { fontFamily: 'var(--ac-font-display)' } : undefined}
                    >
                      {link.label}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
