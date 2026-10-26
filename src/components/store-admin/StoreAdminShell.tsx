'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import { StoreAdminLogoutButton } from './StoreAdminLogoutButton';

export interface ShellSession {
  name: string;
  email: string;
  role: 'store_owner' | 'store_admin' | 'store_viewer';
  mustChangePassword: boolean;
}

type IconName =
  | 'grid'
  | 'bag'
  | 'inbox'
  | 'register'
  | 'rotate'
  | 'card'
  | 'box'
  | 'layers'
  | 'alert'
  | 'star'
  | 'image'
  | 'users'
  | 'mail'
  | 'chart'
  | 'settings'
  | 'shield'
  | 'scroll'
  | 'search'
  | 'menu'
  | 'close'
  | 'chevron'
  | 'pin'
  | 'external'
  | 'bell'
  | 'collapse'
  | 'spark';

const ICONS: Record<IconName, React.ReactNode> = {
  grid: (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.6" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6" />
    </>
  ),
  bag: (
    <>
      <path d="M5 7h14l-1 13H6L5 7Z" />
      <path d="M9 7V5.5a3 3 0 0 1 6 0V7" />
    </>
  ),
  inbox: (
    <>
      <path d="M3 5h18v14H3z" />
      <path d="m3 13 5-3h8l5 3" />
      <path d="M8 16h8" />
    </>
  ),
  register: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 8h10M7 12h4M7 16h10" />
    </>
  ),
  rotate: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
    </>
  ),
  card: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="M2.5 10h19M7 15h4" />
    </>
  ),
  box: (
    <>
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
      <path d="m4 7.5 8 4.5 8-4.5M12 12v9" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3 2.8 20h18.4L12 3Z" />
      <path d="M12 9v5M12 17.2v.1" />
    </>
  ),
  star: (
    <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" />
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9" r="1.5" />
      <path d="m4 17 5-5 4 4 3-3 4 4" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20a6 6 0 0 1 12 0M16 5.5a3.2 3.2 0 0 1 0 6M17.5 14.4A6 6 0 0 1 21 20" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20V4M4 20h17" />
      <path d="M8 16v-5M12 16V8M16 16v-3M20 16V6" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a8 8 0 0 0 .1-6l2-1.2-2-3.4-2.2 1a8 8 0 0 0-5.2-3L12 0h-4l-.1 2.4a8 8 0 0 0-5.2 3l-2.2-1-2 3.4 2 1.2a8 8 0 0 0 .1 6l-2 1.2 2 3.4 2.2-1a8 8 0 0 0 5.2 3L8 24h4l.1-2.4a8 8 0 0 0 5.2-3l2.2 1 2-3.4-2.1-1.2Z" transform="translate(2 0) scale(.84)" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 4.5 6v6c0 4.6 3.2 7.8 7.5 9 4.3-1.2 7.5-4.4 7.5-9V6L12 3Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  scroll: (
    <>
      <path d="M6 3h12v18H6z" />
      <path d="M9 7h6M9 11h6M9 15h4" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  pin: (
    <>
      <path d="m9 4 6 6-2.5 1.5L17 17l-3 1-4.5-4.5L8 16 5 9l4-5Z" />
      <path d="m8 16-4 4" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6M20 4l-9 9" />
      <path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
    </>
  ),
  bell: (
    <>
      <path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6Z" />
      <path d="M10 20h4" />
    </>
  ),
  collapse: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2.5" />
      <path d="M9 3v18M14 9l-2 3 2 3" />
    </>
  ),
  spark: (
    <>
      <path d="m12 3 1.7 4.8L18.5 9.5l-4.8 1.7L12 16l-1.7-4.8L5.5 9.5l4.8-1.7L12 3Z" />
      <path d="m18.5 15 .9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9.9-2.6Z" />
    </>
  ),
};

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {ICONS[name]}
    </svg>
  );
}

interface NavItem {
  href?: string;
  label: string;
  icon: IconName;
  soon?: boolean;
  exact?: boolean;
  /** When set, only these roles see the entry. */
  roles?: ShellSession['role'][];
  /** Overrides the default prefix match (used by Customers detail pages). */
  activeWhen?: (pathname: string) => boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [{ href: '/store-admin', label: 'Overview', icon: 'grid', exact: true }],
  },
  {
    label: 'Sales',
    items: [
      { href: '/store-admin/orders', label: 'Orders', icon: 'bag' },
      { href: '/store-admin/requests', label: 'Requests', icon: 'inbox' },
      { href: '/store-admin/pos', label: 'Point of sale', icon: 'register' },
      { href: '/store-admin/returns', label: 'Returns & refunds', icon: 'rotate' },
      { href: '/store-admin/payments', label: 'Payments', icon: 'card' },
    ],
  },
  {
    label: 'Catalog',
    items: [
      { href: '/store-admin/products', label: 'Products', icon: 'box' },
      { href: '/store-admin/categories', label: 'Categories', icon: 'layers' },
      { href: '/store-admin/stock', label: 'Stock', icon: 'scroll' },
      { href: '/store-admin/catalog', label: 'Catalogue data', icon: 'grid', exact: true },
      { href: '/store-admin/low-stock', label: 'Low stock', icon: 'alert' },
      { href: '/store-admin/reviews', label: 'Reviews', icon: 'star' },
      { href: '/store-admin/media', label: 'Media library', icon: 'image' },
      { href: '/store-admin/catalog/transfer', label: 'Import & export', icon: 'external' },
    ],
  },
  {
    label: 'Customers',
    items: [
      {
        href: '/store-admin/customers',
        label: 'Customers',
        icon: 'users',
        activeWhen: (pathname) =>
          pathname === '/store-admin/customers' ||
          /^\/store-admin\/customers\/(?!accounts$|subscribers$|settings$)[^/]+$/.test(
            pathname,
          ),
      },
      { href: '/store-admin/customers/accounts', label: 'User accounts', icon: 'shield' },
      { href: '/store-admin/customers/subscribers', label: 'Subscribers', icon: 'mail' },
      { href: '/store-admin/customers/settings', label: 'Customer settings', icon: 'settings' },
    ],
  },
  {
    label: 'Insights',
    items: [
      { href: '/store-admin/reports', label: 'Reports', icon: 'chart' },
      { href: '/store-admin/expenses', label: 'Expenses', icon: 'card' },
    ],
  },
  {
    label: 'Settings',
    items: [
      {
        href: '/store-admin/settings',
        label: 'Settings',
        icon: 'settings',
        // Settings stays highlighted on its subpages, except the two that have
        // their own sidebar entries.
        activeWhen: (pathname) =>
          pathname === '/store-admin/settings' ||
          (/^\/store-admin\/settings\/[^/]+$/.test(pathname) &&
            pathname !== '/store-admin/settings/reasons' &&
            pathname !== '/store-admin/settings/staff'),
      },
      { href: '/store-admin/settings/reasons', label: 'Reasons', icon: 'rotate' },
      {
        href: '/store-admin/settings/staff',
        label: 'Staff & roles',
        icon: 'shield',
        roles: ['store_owner', 'store_admin'],
      },
      {
        href: '/store-admin/audit-log',
        label: 'Audit log',
        icon: 'scroll',
        roles: ['store_owner', 'store_admin'],
      },
    ],
  },
];

const ROLE_LABEL: Record<ShellSession['role'], string> = {
  store_owner: 'Owner',
  store_admin: 'Admin',
  store_viewer: 'Viewer',
};

const PIN_KEY = 'gadzio_sa_pins';
const RAIL_KEY = 'gadzio_sa_rail';

function isActive(pathname: string, item: NavItem): boolean {
  if (!item.href) return false;
  if (item.activeWhen) return item.activeWhen(pathname);
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function currentLabel(pathname: string): string {
  // The most specific match wins, so a settings subpage shows its own name
  // rather than the parent "Settings" entry.
  let match: NavItem | null = null;
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (!isActive(pathname, item)) continue;
      if (!match || (item.href?.length ?? 0) > (match.href?.length ?? 0)) match = item;
    }
  }
  return match?.label ?? 'Overview';
}

export function StoreAdminShell({
  session,
  children,
}: {
  session: ShellSession;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const searchRef = useRef<HTMLInputElement>(null);
  const userMenuRef = useRef<HTMLDetailsElement>(null);
  const [rail, setRail] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [pins, setPins] = useState<string[]>([]);

  useEffect(() => {
    try {
      setRail(window.localStorage.getItem(RAIL_KEY) === '1');
      const stored = window.localStorage.getItem(PIN_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setPins(parsed.filter((value): value is string => typeof value === 'string'));
        }
      }
    } catch {
      // localStorage can be unavailable in private modes; defaults still work.
    }
  }, []);

  useEffect(() => {
    setDrawer(false);
    if (userMenuRef.current) userMenuRef.current.open = false;
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = drawer ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [drawer]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setDrawer(false);
        if (userMenuRef.current) userMenuRef.current.open = false;
        return;
      }
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable;
      if (event.key === '/' && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function toggleRail() {
    setRail((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(RAIL_KEY, next ? '1' : '0');
      } catch {
        // ignore storage errors
      }
      return next;
    });
  }

  function togglePin(href: string) {
    setPins((current) => {
      const next = current.includes(href)
        ? current.filter((value) => value !== href)
        : [...current, href];
      try {
        window.localStorage.setItem(PIN_KEY, JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  }

  const initial = (session.name || session.email || 'G').trim().charAt(0).toUpperCase();
  const label = currentLabel(pathname);

  const pinnedItems = useMemo(() => {
    const all = NAV_GROUPS.flatMap((group) => group.items).filter(
      (item) => !item.roles || item.roles.includes(session.role),
    );
    return pins
      .map((href) => all.find((item) => item.href === href))
      .filter((item): item is NavItem => Boolean(item));
  }, [pins, session.role]);

  function renderItem(item: NavItem, inPinned = false) {
    const active = isActive(pathname, item);
    const content = (
      <>
        <span className="sa-nav-icon">
          <Icon name={item.icon} />
        </span>
        <span className="sa-nav-label">{item.label}</span>
        {item.soon ? <span className="sa-nav-pill">Soon</span> : null}
        {active && !item.soon ? <span className="sa-nav-marker" aria-hidden="true" /> : null}
      </>
    );

    if (!item.href || item.soon) {
      return (
        <span
          className={`sa-nav-item sa-nav-item-soon${active ? ' is-active' : ''}`}
          key={item.label}
          title={`${item.label} — planned`}
        >
          {content}
        </span>
      );
    }

    return (
      <div className="sa-nav-row" key={item.href}>
        <Link
          href={item.href}
          className={`sa-nav-item${active ? ' is-active' : ''}`}
          aria-current={active ? 'page' : undefined}
          title={rail ? item.label : undefined}
        >
          {content}
        </Link>
        {!rail && !inPinned ? (
          <button
            type="button"
            className={`sa-pin${pins.includes(item.href) ? ' is-pinned' : ''}`}
            onClick={() => togglePin(item.href as string)}
            aria-label={pins.includes(item.href) ? `Unpin ${item.label}` : `Pin ${item.label}`}
            title={pins.includes(item.href) ? 'Unpin' : 'Pin to top'}
          >
            <Icon name="pin" size={13} />
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`sa-shell${rail ? ' sa-rail' : ''}${drawer ? ' sa-drawer-open' : ''}`}>
      <button
        type="button"
        className="sa-scrim"
        aria-label="Close navigation"
        onClick={() => setDrawer(false)}
      />

      <aside className="sa-sidebar" aria-label="Store admin navigation">
        <div className="sa-side-brand">
          <Link href="/store-admin" className="sa-logo" aria-label="Gadzio Store Desk home">
            <span className="sa-logo-mark" aria-hidden="true">G</span>
            <span className="sa-logo-text">
              <strong>Gadzio</strong>
              <span>Store Desk</span>
            </span>
          </Link>
          <button
            type="button"
            className="sa-rail-toggle"
            onClick={toggleRail}
            aria-label={rail ? 'Expand navigation' : 'Collapse navigation'}
            title={rail ? 'Expand navigation' : 'Collapse navigation'}
          >
            <Icon name="collapse" size={17} />
          </button>
          <button
            type="button"
            className="sa-drawer-close"
            onClick={() => setDrawer(false)}
            aria-label="Close navigation"
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        <nav className="sa-side-nav">
          {pinnedItems.length > 0 ? (
            <div className="sa-nav-group sa-pinned-group">
              <p className="sa-nav-group-label">Pinned</p>
              {pinnedItems.map((item) => renderItem(item, true))}
            </div>
          ) : null}

          {NAV_GROUPS.map((group) => (
            <div className="sa-nav-group" key={group.label}>
              <p className="sa-nav-group-label">{group.label}</p>
              {group.items
                .filter((item) => !item.roles || item.roles.includes(session.role))
                .map((item) => renderItem(item))}
            </div>
          ))}
        </nav>

        <div className="sa-side-foot">
          <div className="sa-side-user">
            <span className="sa-avatar sa-avatar-sm">{initial}</span>
            <span className="sa-side-user-text">
              <strong>{session.name || 'Store staff'}</strong>
              <span>{ROLE_LABEL[session.role]}</span>
            </span>
          </div>
          <Link className="sa-side-store-link" href="/" target="_blank" rel="noreferrer">
            <Icon name="external" size={14} />
            <span>View storefront</span>
          </Link>
        </div>
      </aside>

      <div className="sa-frame">
        <header className="sa-topbar">
          <button
            type="button"
            className="sa-icon-btn sa-menu-btn"
            onClick={() => setDrawer(true)}
            aria-label="Open navigation"
          >
            <Icon name="menu" size={20} />
          </button>

          <div className="sa-crumb">
            <span>Store Desk</span>
            <Icon name="chevron" size={13} />
            <strong>{label}</strong>
          </div>

          <form className="sa-global-search" action="/store-admin/orders" role="search">
            <Icon name="search" size={17} />
            <input
              ref={searchRef}
              type="search"
              name="q"
              placeholder="Search orders, customers, products…"
              aria-label="Search orders, customers and products"
            />
            <kbd>/</kbd>
          </form>

          <div className="sa-top-actions">
            <Link
              className="sa-icon-btn sa-bell"
              href="/store-admin/requests"
              aria-label="Open customer requests"
              title="Customer requests"
            >
              <Icon name="bell" size={19} />
              <span className="sa-bell-dot" aria-hidden="true" />
            </Link>
            <span className="sa-env-chip" title="Environment">
              <Icon name="spark" size={13} />
              Live data
            </span>
            <details className="sa-user-menu" ref={userMenuRef}>
              <summary aria-label="Account menu">
                <span className="sa-avatar">{initial}</span>
                <span className="sa-user-meta">
                  <strong>{session.name || 'Store staff'}</strong>
                  <span>{ROLE_LABEL[session.role]}</span>
                </span>
                <Icon name="chevron" size={14} />
              </summary>
              <div className="sa-user-pop">
                <div className="sa-user-pop-head">
                  <span className="sa-avatar">{initial}</span>
                  <div>
                    <strong>{session.name || 'Store staff'}</strong>
                    <span>{session.email}</span>
                  </div>
                </div>
                <Link href="/store-admin/profile">Your profile</Link>
                <Link href="/store-admin/settings">Store settings</Link>
                <Link href="/store-admin/orders">Recent orders</Link>
                <div className="sa-user-pop-foot">
                  <StoreAdminLogoutButton />
                </div>
              </div>
            </details>
          </div>
        </header>

        <main className="sa-main">
          {session.mustChangePassword ? (
            <div className="sa-notice sa-must-change" role="status">
              You are signed in with a temporary password.{' '}
              <Link href="/store-admin/profile">Change it now</Link>.
            </div>
          ) : null}
          <div className="sa-content">{children}</div>
        </main>
      </div>
    </div>
  );
}
