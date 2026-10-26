import type { Metadata } from 'next';
import { CartPageView } from '@/components/cart/CartPageView';
import { getStorefrontRefs } from '@/lib/storefront/catalog';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Shopping Bag - Review your Items | Gadzio Store',
  description: 'Review items in your shopping bag, apply discounts, and check out securely.',
};

export default async function CartPage() {
  const { products } = await getStorefrontRefs();
  return <CartPageView initialProducts={products} />;
}
