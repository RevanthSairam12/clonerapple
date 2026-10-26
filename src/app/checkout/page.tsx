import { getUserSession } from '@/lib/user-auth';
import { CheckoutForm } from '@/components/checkout/CheckoutForm';
import { getProductFromDatabase } from '@/lib/payu/db-catalog';
import { parseCheckoutQuantity } from '@/lib/checkout/checkout-decision';
import { readCheckoutConfiguration } from '@/lib/checkout/settings';
import { EMPTY_SHIPPING_POLICY } from '@/lib/checkout/shipping-rules';
import { isOn } from '@/lib/store-admin/customer-rules';
import { readCustomerSettings } from '@/lib/store-admin/customer-settings';
import { invitationSecondsRemaining } from '@/lib/waitlist/rules';
import { getInvitationByToken } from '@/lib/waitlist/store';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ productId?: string; qty?: string; reservationToken?: string }>;
}

export default async function CheckoutPage({ searchParams }: Props) {
  const session = await getUserSession();
  const settings = await readCustomerSettings();
  const checkoutConfiguration = await readCheckoutConfiguration();
  const { productId: rawProductId, qty, reservationToken: rawToken } = await searchParams;
  const reservationToken = (rawToken ?? '').trim();

  // Guest checkout is off unless the owner enables it under
  // Customers → Customer settings. When it is off, an account is required.
  if (!session && !isOn(settings.guest_checkout)) {
    const returnUrl = reservationToken
      ? `/checkout?reservationToken=${encodeURIComponent(reservationToken)}`
      : rawProductId
        ? `/checkout?productId=${encodeURIComponent(rawProductId)}${qty ? `&qty=${encodeURIComponent(qty)}` : ''}`
        : '/checkout';
    redirect(`/auth?redirect=${encodeURIComponent(returnUrl)}`);
  }

  // A reservation link is revalidated on every open: ownership, expiry, the
  // product still being active and the hold still being HELD. The claim is not
  // extended just because the page was opened again.
  const invitation = reservationToken ? await getInvitationByToken(reservationToken) : null;
  if (reservationToken) {
    if (!session) {
      redirect(`/auth?redirect=${encodeURIComponent(`/waitlist/claim?token=${reservationToken}`)}`);
    }
    if (!invitation || invitation.userId !== session.userId || !invitation.isOpen) {
      return (
        <div className="min-h-screen bg-[#f5f5f7] py-10 px-4 sm:px-6 lg:px-8 text-[#1d1d1f]">
          <div className="max-w-xl mx-auto bg-white rounded-3xl p-8 sm:p-10 shadow-sm border border-[#e5e5ea] text-center">
            <h1 className="text-2xl font-semibold tracking-tight">This reservation is no longer available</h1>
            <p className="text-sm text-[#86868b] mt-3">
              The held unit expired, was already claimed, or belongs to a different account. The
              unit has been offered to the next customer, so this link cannot reserve it again.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                href={invitation ? `/shop/product/${encodeURIComponent(invitation.productId)}` : '/shop'}
                className="inline-flex items-center justify-center min-h-[44px] px-6 rounded-full bg-[#0071e3] hover:bg-[#0077ed] text-white text-sm font-semibold transition"
              >
                View the product
              </Link>
              <Link
                href="/"
                className="inline-flex items-center justify-center min-h-[44px] px-6 rounded-full border border-[#d2d2d7] text-[#1d1d1f] text-sm font-semibold hover:bg-[#f5f5f7] transition"
              >
                Return to Store
              </Link>
            </div>
          </div>
        </div>
      );
    }
  }

  const productId = invitation ? invitation.productId : rawProductId;
  const parsedQty = invitation ? 1 : parseCheckoutQuantity(qty);
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

  const reservationSeconds = invitation
    ? invitationSecondsRemaining(invitation.expiresAt, new Date())
    : 0;

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
        shippingPolicy={checkoutConfiguration.ok ? checkoutConfiguration.policy : EMPTY_SHIPPING_POLICY}
        paymentNote={checkoutConfiguration.ok ? checkoutConfiguration.settings.payment_note : ''}
        reservationToken={invitation ? reservationToken : ''}
        reservationSeconds={reservationSeconds}
      />
    </div>
  );
}
