import type { Metadata } from 'next';
import { CartPageView } from '@/components/cart/CartPageView';
import { readCheckoutConfiguration } from '@/lib/checkout/settings';
import { readSaleState } from '@/lib/storefront/sale-state';
import { getStorefrontRefs } from '@/lib/storefront/catalog';
import { getUserSession } from '@/lib/user-auth';
import { readCustomerSettings } from '@/lib/store-admin/customer-settings';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Shopping Bag - Review your Items | Gadzio Store',
  description: 'Review items in your shopping bag, apply discounts, and check out securely.',
};

export default async function BagPage() {
  const saleClock = await readSaleState();
  const [{ products, saleLive }, configuration, session, customerSettings] = await Promise.all([
    getStorefrontRefs(saleClock),
    readCheckoutConfiguration(),
    getUserSession(),
    readCustomerSettings(),
  ]);
  return (
    <CartPageView
      initialProducts={products}
      shippingPolicy={configuration.ok ? configuration.policy : null}
      saleLive={saleLive}
      saleClock={{ enabled: saleClock.enabled, databaseNow: saleClock.databaseNow, startsAt: saleClock.startsAt, endsAt: saleClock.endsAt }}
      customerEmail={session?.email || null}
      guestCheckoutEnabled={customerSettings.guest_checkout === 'on'}
      couponsEnabled={configuration.ok && configuration.settings.coupons_enabled === 'on'}
    />
  );
}
