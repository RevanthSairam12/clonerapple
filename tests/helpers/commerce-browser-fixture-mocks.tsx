// Test-only aliases. Deliberately no application data/auth/backend imports.
import React, { type ReactNode } from 'react';
export const router = {
  push(href: string) { window.__commerceFixture.navigation.push(href); },
  replace(href: string) { window.__commerceFixture.navigation.push(href); },
  refresh() { window.__commerceFixture.refreshes++; },
};
export function useRouter() { return router; }
export function usePathname() { return '/fixture'; }
export function useSearchParams() { return new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search); }
export default function FixtureLink({ href, children, onClick, prefetch: _prefetch, ...props }: { href: string; children: ReactNode; onClick?: React.MouseEventHandler<HTMLAnchorElement>; prefetch?: boolean; [key: string]: any }) {
  return <a href={href} {...props} onClick={event => { onClick?.(event); if (!event.defaultPrevented) { event.preventDefault(); router.push(href); } }}>{children}</a>;
}
export function GlobalNav() { return <nav aria-label="Synthetic fixture navigation">Synthetic commerce fixture — no real account or payment</nav>; }
export function GlobalFooter() { return <footer>Test-only component composition</footer>; }
export function GadzioTrustBar() { return null; }
export const DEFAULT_TRUST_BADGES = [];
export function getSuggestedProducts() { return { products: [], reason: 'Synthetic fixture: no recommendations', topTerms: [] }; }
export function useCheckoutRefresh() { /* No server refresh or timers in this fixture. */ }
export const user = { userId: 'fixture-customer', email: 'fixture@example.invalid', firstName: 'Fixture', lastName: 'Customer' };
export const address = { id: 'fixture-address', name: 'Fixture Customer', phone: '9876543210', line1: '12 Synthetic Street', line2: '', city: 'Mumbai', state: 'Maharashtra', pincode: '400001', isDefault: true };
