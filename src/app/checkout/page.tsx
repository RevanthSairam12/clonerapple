import { getUserSession } from '@/lib/user-auth';
import { CheckoutForm } from '@/components/checkout/CheckoutForm';
import { getProductFromCatalog } from '@/lib/payu/catalog';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ productId?: string; qty?: string }>;
}

export default async function CheckoutPage({ searchParams }: Props) {
  const session = await getUserSession();
  const { productId, qty } = await searchParams;

  if (!session) {
    const returnUrl = productId
      ? `/checkout?productId=${encodeURIComponent(productId)}${qty ? `&qty=${encodeURIComponent(qty)}` : ''}`
      : '/checkout';
    redirect(`/auth?redirect=${encodeURIComponent(returnUrl)}`);
  }

  const parsedQty = Math.max(1, parseInt(qty || '1', 10));
  let items = undefined;

  if (productId) {
    const product = getProductFromCatalog(productId);
    if (product) {
      items = [
        {
          id: product.id,
          name: product.name,
          price: product.price,
          quantity: parsedQty,
        },
      ];
    }
  }

  return (
    <div className="min-h-screen bg-[#f5f5f7] py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto mb-6 flex justify-between items-center text-sm">
        <div className="flex items-center gap-3">
          <Link href="/cart" className="text-[#0071e3] hover:underline font-medium">
            ← Review Bag
          </Link>
          <span className="text-[#86868b]">•</span>
          <Link href="/" className="text-[#86868b] hover:text-[#1d1d1f] hover:underline">
            Store
          </Link>
        </div>
        {session ? (
          <span className="text-[#86868b] text-xs">
            Logged in as <strong className="text-[#1d1d1f]">{session.email}</strong>
          </span>
        ) : (
          <Link href="/auth" className="text-[#0071e3] hover:underline text-xs">
            Already have an account? Sign in
          </Link>
        )}
      </div>

      <CheckoutForm initialItems={items} userSession={session} />
    </div>
  );
}
