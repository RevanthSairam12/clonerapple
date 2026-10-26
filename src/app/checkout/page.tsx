import { getUserSession } from '@/lib/user-auth';
import { CheckoutForm } from '@/components/checkout/CheckoutForm';
import { getProductFromDatabase } from '@/lib/payu/db-catalog';
import { parseCheckoutQuantity } from '@/lib/checkout/checkout-decision';
import { isOn } from '@/lib/store-admin/customer-rules';
import { readCustomerSettings } from '@/lib/store-admin/customer-settings';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ productId?: string; qty?: string }>;
}

export default async function CheckoutPage({ searchParams }: Props) {
  const session = await getUserSession();
  const settings = await readCustomerSettings();
  const { productId, qty } = await searchParams;

  // Guest checkout is off unless the owner enables it under
  // Customers → Customer settings. When it is off, an account is required.
  if (!session && !isOn(settings.guest_checkout)) {
    const returnUrl = productId
      ? `/checkout?productId=${encodeURIComponent(productId)}${qty ? `&qty=${encodeURIComponent(qty)}` : ''}`
      : '/checkout';
    redirect(`/auth?redirect=${encodeURIComponent(returnUrl)}`);
  }

  const parsedQty = parseCheckoutQuantity(qty);
  const requestedProduct = productId ? await getProductFromDatabase(productId) : null;
  // A productId in the URL that resolves to nothing is an unavailable state,
  // but only if the customer has nothing in their bag. The live bag is read on
  // the client; CheckoutForm applies that rule after hydration.
  const productUnavailable = Boolean(productId) && requestedProduct === null;
  let items = undefined;

  if (requestedProduct) {
    items = [
      {
        id: requestedProduct.id,
        name: requestedProduct.name,
        price: requestedProduct.price,
        quantity: parsedQty,
      },
    ];
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

      <CheckoutForm
        initialItems={items}
        userSession={session}
        productUnavailable={productUnavailable}
        productIdFromQuery={productId}
        marketingOptInEnabled={isOn(settings.checkout_marketing_optin)}
      />
    </div>
  );
}
