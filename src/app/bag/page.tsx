import type { Metadata } from 'next';
import { CartPageView } from '@/components/cart/CartPageView';
import { readShippingPolicy } from '@/lib/checkout/settings';
import { EMPTY_SHIPPING_POLICY } from '@/lib/checkout/shipping-rules';
import { getStorefrontRefs } from '@/lib/storefront/catalog';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Shopping Bag - Review your Items | Gadzio Store',
  description: 'Review items in your shopping bag, apply discounts, and check out securely.',
};

export default async function BagPage() {
  const [{ products, saleLive }, policy] = await Promise.all([
    getStorefrontRefs(),
    readShippingPolicy(),
  ]);
  return (
    <CartPageView
      initialProducts={products}
      shippingPolicy={policy.ok ? policy.policy : EMPTY_SHIPPING_POLICY}
      saleLive={saleLive}
    />
  );
}
