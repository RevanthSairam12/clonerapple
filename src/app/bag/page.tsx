import type { Metadata } from 'next';
import { CartPageView } from '@/components/cart/CartPageView';
import { readCheckoutConfiguration } from '@/lib/checkout/settings';
import { EMPTY_SHIPPING_POLICY } from '@/lib/checkout/shipping-rules';
import { getStorefrontRefs } from '@/lib/storefront/catalog';
import { getUserSession } from '@/lib/user-auth';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Shopping Bag - Review your Items | Gadzio Store',
  description: 'Review items in your shopping bag, apply discounts, and check out securely.',
};

export default async function BagPage() {
  const [{ products, saleLive }, configuration, session] = await Promise.all([
    getStorefrontRefs(),
    readCheckoutConfiguration(),
    getUserSession(),
  ]);
  return (
    <CartPageView
      initialProducts={products}
      shippingPolicy={configuration.ok ? configuration.policy : EMPTY_SHIPPING_POLICY}
      saleLive={saleLive}
      customerEmail={session?.email || null}
      couponsEnabled={configuration.ok && configuration.settings.coupons_enabled === 'on'}
    />
  );
}
