import Link from 'next/link';

const LINKS = [
  { href: '/store-admin/settings', label: 'Business & maintenance' },
  { href: '/store-admin/settings/orders', label: 'Orders' },
  { href: '/store-admin/settings/payments', label: 'Payments' },
  { href: '/store-admin/settings/shipping', label: 'Shipping' },
  { href: '/store-admin/settings/mail', label: 'Email & SMS' },
  { href: '/store-admin/settings/storefront', label: 'Storefront' },
  { href: '/store-admin/settings/notifications', label: 'Notifications' },
  { href: '/store-admin/settings/content', label: 'Pages & SEO' },
  { href: '/store-admin/settings/analytics', label: 'Social & analytics' },
  { href: '/store-admin/settings/reasons', label: 'Reasons' },
] as const;

/** The sub-navigation shared by every settings screen. */
export function SettingsNav({ active }: { active: string }) {
  return (
    <nav className="sa-settings-nav" aria-label="Settings sections">
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={`sa-settings-nav-link${link.href === active ? ' is-active' : ''}`}
          aria-current={link.href === active ? 'page' : undefined}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
