import { getUserSession } from '@/lib/user-auth';
import { CheckoutForm } from '@/components/checkout/CheckoutForm';
import { buildCartLineId } from '@/lib/cart/cart-id';
import { parseCheckoutQuantity } from '@/lib/checkout/checkout-decision';
import { readCheckoutConfiguration } from '@/lib/checkout/settings';
import { readSaleState } from '@/lib/storefront/sale-state';
import { isOn } from '@/lib/store-admin/customer-rules';
import { readCustomerSettings } from '@/lib/store-admin/customer-settings';
import { getProductDetail, getStorefrontRefs } from '@/lib/storefront/catalog';
import { galleryForSelection } from '@/lib/storefront/option-selection';
import Link from 'next/link';
import { GlobalNav } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/GlobalNav';
import { GlobalFooter } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/GlobalFooter';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ productId?: string; variantId?: string; qty?: string }>;
}

export default async function CheckoutPage({ searchParams }: Props) {
  const session = await getUserSession();
  const settings = await readCustomerSettings();
  const checkoutConfiguration = await readCheckoutConfiguration();
  const saleClock = await readSaleState();
  const { products, saleLive } = await getStorefrontRefs(saleClock);
  const { productId: rawProductId, variantId, qty } = await searchParams;

  // The same availability the bag and detail pages show. Checkout re-checks
  // under the stock row lock; this only stops an obviously unsellable order.
  const stockById: Record<string, boolean> = {};
  for (const product of products) {
    stockById[product.id.trim().toLowerCase()] = product.inStock;
  }

  // Guest checkout is off unless the owner enables it under
  // Customers → Customer settings. When it is off, an account is required.
  if (!session && !isOn(settings.guest_checkout)) {
    const returnUrl = rawProductId
      ? `/checkout?productId=${encodeURIComponent(rawProductId)}${variantId ? `&variantId=${encodeURIComponent(variantId)}` : ''}${qty ? `&qty=${encodeURIComponent(qty)}` : ''}`
      : '/checkout';
    redirect(`/auth?redirect=${encodeURIComponent(returnUrl)}`);
  }

  const productId = rawProductId;
  const parsedQty = parseCheckoutQuantity(qty);
  const requestedProduct = productId ? products.find((product) => product.id.toLowerCase() === productId.trim().toLowerCase()) ?? null : null;
  // A productId in the URL that resolves to nothing is an unavailable state,
  // but only if the customer has nothing in their bag. The live bag is read on
  // the client; CheckoutForm applies that rule after hydration.
  const productUnavailable = Boolean(productId) && requestedProduct === null;
  let items = undefined;

  if (requestedProduct) {
    const variant = requestedProduct.purchasableVariants?.find((entry) => entry.id === variantId);
    // The chosen colour's own photo, exactly as the product page showed it.
    const detail = await getProductDetail(requestedProduct.id);
    const photos = galleryForSelection(
      detail?.product.photoGallery ?? [],
      [requestedProduct.image],
      { modelKey: null, colourKey: variant?.colourId ?? null },
      requestedProduct.name,
      variant?.colourName ?? null,
    );
    items = [
      {
        id: buildCartLineId({ productId: requestedProduct.id, variantId }),
        productId: requestedProduct.id, variantId, variantSku: variant?.sku, variantLabel: variant?.label,
        name: requestedProduct.name + (variant ? ` (${variant.label})` : ''),
        price: requestedProduct.pricePaise / 100,
        image: photos[0]?.url ?? requestedProduct.image,
        ...(requestedProduct.regularPricePaise !== undefined
          ? { regularPrice: requestedProduct.regularPricePaise! / 100 }
          : {}),
        quantity: parsedQty,
      },
    ];
  }

  return (
    <div className="gz-storefront-page min-h-screen bg-[#e8eaee]" style={{ fontFamily: 'transducer, sans-serif' }}>
      <GlobalNav bannerVisible={false} />
      <main className="px-4 py-10 sm:px-8">
      <div className="max-w-6xl mx-auto mb-6 flex flex-wrap justify-between items-center gap-3 text-sm">
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
          <span className="min-w-0 break-words text-[#6e6e73] text-xs">
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
        shippingPolicy={checkoutConfiguration.ok ? checkoutConfiguration.policy : null}
        paymentNote={checkoutConfiguration.ok ? checkoutConfiguration.settings.payment_note : ''}
        saleLive={saleLive}
        initialProducts={products}
        saleClock={{ enabled: saleClock.enabled, databaseNow: saleClock.databaseNow, startsAt: saleClock.startsAt, endsAt: saleClock.endsAt }}
        stockById={stockById}
        couponsEnabled={checkoutConfiguration.ok && isOn(checkoutConfiguration.settings.coupons_enabled)}
      />
      </main>
      <GlobalFooter />
    </div>
  );
}
