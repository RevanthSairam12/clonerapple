'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useCart, type CartPriceUpdate } from '@/lib/cart/CartContext';
import { getProductFromCatalog } from '@/lib/payu/catalog';
import { stockBlocked } from '@/lib/storefront/availability-rules';
import { getCartLineBaseId } from '@/lib/cart/cart-id';
import { decideCheckoutView } from '@/lib/checkout/checkout-decision';
import {
  EMPTY_SHIPPING_POLICY,
  quoteShipping,
  type ShippingPolicy,
} from '@/lib/checkout/shipping-rules';
import { useCoupon } from '@/lib/cart/useCoupon';
import { CouponBox } from '@/components/cart/CouponBox';

interface CartItem {
  id: string;
  productId?: string;
  name: string;
  price: number;
  /** The regular price shown struck through while a sale is live. */
  regularPrice?: number;
  wasPriceDisplay?: string;
  quantity: number;
  image?: string;
}

interface SavedAddress {
  id: string;
  name: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
}

interface Props {
  initialItems?: CartItem[];
  userSession?: {
    email: string;
    firstName: string;
    lastName: string;
  } | null;
  /** True when the URL named a productId that is not in the PayU catalog. */
  productUnavailable?: boolean;
  /** The raw `?productId=`, used to clear it from the URL when the bag wins. */
  productIdFromQuery?: string;
  /** Customers → Customer settings controls this checkbox. */
  marketingOptInEnabled?: boolean;
  /** Store Admin shipping rules; the same quote initiate charges. */
  shippingPolicy?: ShippingPolicy;
  /** Payments → "Checkout payment note". Empty by default. */
  paymentNote?: string;
  /**
   * The sale switch on the database clock. A live sale never disables a line
   * for stock; the authoritative check happens at Pay.
   */
  saleLive?: boolean;
  /**
   * Storefront availability keyed by lowercase product id. A missing id means
   * the product is not in the catalogue. When omitted, the static PayU
   * catalogue is used, which is what this form did before stock was wired.
   */
  stockById?: Record<string, boolean>;
  /** Payments → Coupons. Off hides the box; the server refuses codes anyway. */
  couponsEnabled?: boolean;
}

export function CheckoutForm({ initialItems, userSession, productUnavailable = false, productIdFromQuery, marketingOptInEnabled = false, shippingPolicy = EMPTY_SHIPPING_POLICY, paymentNote = '', saleLive = false, stockById, couponsEnabled = true }: Props) {
  const { items: bagItems, removeItem, syncPrices, isHydrated } = useCart();

  const decision = decideCheckoutView({
    isHydrated,
    bagItemCount: bagItems.length,
    productId: productIdFromQuery,
    initialItemCount: initialItems?.length ?? 0,
    productUnavailable,
  });

  // If the bag has items, a bad or stale ?productId= is ignored and the URL is
  // replaced with plain /checkout so a refresh cannot resurrect the dead link.
  // Only an empty bag falls back to the product resolved from ?productId=.
  React.useEffect(() => {
    if (!decision.clearProductQueryFromUrl) return;
    if (typeof window === 'undefined') return;
    window.history.replaceState(window.history.state, '', '/checkout');
  }, [decision.clearProductQueryFromUrl]);

  const items: CartItem[] =
    decision.view === 'bag'
      ? bagItems.map((b) => ({
          id: b.id,
          productId: b.productId,
          name: b.name + (b.subtitle ? ` (${b.subtitle})` : ''),
          price: b.price,
          ...(b.regularPrice !== undefined ? { regularPrice: b.regularPrice } : {}),
          ...(b.wasPriceDisplay ? { wasPriceDisplay: b.wasPriceDisplay } : {}),
          quantity: b.quantity,
          image: b.image,
        }))
      : decision.view === 'product'
        ? initialItems ?? []
        : [];

  // A line is only payable when the catalogue still sells it. The storefront
  // stock state decides (sale mode ignores stock); a missing catalogue id is
  // unavailable. Without `stockById` the static PayU catalogue is the fallback.
  const lineAvailable = (item: CartItem): boolean => {
    const baseId = (getCartLineBaseId(item.productId || item.id) || '').trim().toLowerCase();
    if (!stockById) return Boolean(getProductFromCatalog(baseId));
    const inStock = stockById[baseId];
    if (typeof inStock !== 'boolean') return false;
    return !stockBlocked(inStock, saleLive);
  };
  const unavailableIds = new Set(
    items.filter((item) => !lineAvailable(item)).map((item) => item.id)
  );
  const hasUnavailable = unavailableIds.size > 0;
  const payableItems = items.filter((item) => !unavailableIds.has(item.id));

  const [firstName, setFirstName] = useState(userSession?.firstName || '');
  const [email, setEmail] = useState(userSession?.email || '');
  const [phone, setPhone] = useState('');
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState('');
  const [saveNewAddress, setSaveNewAddress] = useState(true);
  const [shippingAddress, setShippingAddress] = useState({
    name: `${userSession?.firstName || ''} ${userSession?.lastName || ''}`.trim(),
    phone: '',
    line1: '',
    line2: '',
    city: '',
    state: '',
    pincode: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [marketingOptIn, setMarketingOptIn] = useState(false);

  React.useEffect(() => {
    fetch('/api/account/addresses')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const addresses = Array.isArray(data?.addresses) ? data.addresses : [];
        setSavedAddresses(addresses);
        const preferred = addresses.find((address: SavedAddress) => address.isDefault) || addresses[0];
        if (preferred) {
          setSelectedAddressId(preferred.id);
          setShippingAddress({
            name: preferred.name,
            phone: preferred.phone,
            line1: preferred.line1,
            line2: preferred.line2 || '',
            city: preferred.city,
            state: preferred.state,
            pincode: preferred.pincode,
          });
          setPhone(preferred.phone);
        }
      })
      .catch(() => {});
  }, []);

  const updateShippingAddress = (field: keyof typeof shippingAddress, value: string) => {
    setSelectedAddressId('');
    setShippingAddress((current) => ({ ...current, [field]: value }));
    if (field === 'phone') setPhone(value);
  };

  const selectSavedAddress = (id: string) => {
    setSelectedAddressId(id);
    const selected = savedAddresses.find((address) => address.id === id);
    if (!selected) return;
    setShippingAddress({
      name: selected.name,
      phone: selected.phone,
      line1: selected.line1,
      line2: selected.line2 || '',
      city: selected.city,
      state: selected.state,
      pincode: selected.pincode,
    });
    setPhone(selected.phone);
  };

  const subtotalAmount = payableItems.reduce((acc, i) => acc + i.price * i.quantity, 0);
  const shippingAmount =
    quoteShipping(Math.round(subtotalAmount * 100), shippingPolicy).shippingPaise / 100;

  // The coupon preview runs the same server rules checkout will run under the
  // row lock. The shown total is only ever the server's answer.
  const coupon = useCoupon({
    items: payableItems.map((i) => ({
      id: getCartLineBaseId(i.productId || i.id) || i.productId || i.id,
      quantity: i.quantity,
      price: i.price,
    })),
    subtotalPaise: Math.round(subtotalAmount * 100),
    shippingPaise: Math.round(shippingAmount * 100),
    email,
    enabled: couponsEnabled && payableItems.length > 0,
  });
  const discountAmount = coupon.totals.discountPaise / 100;
  const totalAmount = coupon.totals.totalPaise / 100;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    setErrorMessage(null);

    if (items.length === 0) {
      setErrorMessage('Your bag is empty.');
      return;
    }
    if (hasUnavailable) {
      const unavailableNames = items
        .filter((item) => unavailableIds.has(item.id))
        .map((item) => item.name)
        .join(', ');
      setErrorMessage(`Remove ${unavailableNames || 'the unavailable item'} from your order before paying.`);
      return;
    }

    // Basic client validation
    if (!firstName.trim() || firstName.trim().length < 2) {
      setErrorMessage('Please enter a valid first name.');
      return;
    }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }
    const cleanPhone = phone.replace(/\D/g, '');
    if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
      setErrorMessage('Please enter a valid 10-digit Indian mobile number (starting with 6, 7, 8, or 9).');
      return;
    }
    if (!selectedAddressId) {
      const addressPhone = shippingAddress.phone.replace(/\D/g, '');
      if (shippingAddress.name.trim().length < 2 || !/^\d{10}$/.test(addressPhone) || !shippingAddress.line1.trim() || !shippingAddress.state.trim() || !/^\d{6}$/.test(shippingAddress.pincode)) {
        setErrorMessage('Enter a valid shipping name, 10-digit phone, address line 1, state, and 6-digit pincode.');
        return;
      }
    }

    // Disable the button to prevent double submission
    setIsSubmitting(true);

    try {
      // Re-check the code against the cart as it stands right now. If it no
      // longer holds, nothing is sent: the customer must see the new total
      // before paying instead of being charged something they did not agree to.
      const checkedCoupon = couponsEnabled ? await coupon.revalidate() : null;
      if (couponsEnabled && coupon.appliedCode && !checkedCoupon) {
        setIsSubmitting(false);
        setErrorMessage('The coupon was removed. Please review your updated total and pay again.');
        return;
      }

      let shippingAddressId = selectedAddressId;
      // Guests have no address book; the address rides along with the order.
      if (!shippingAddressId && saveNewAddress && userSession) {
        const saveResponse = await fetch('/api/account/addresses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...shippingAddress, isDefault: savedAddresses.length === 0 }),
        });
        const saveData = await saveResponse.json();
        if (!saveResponse.ok) throw new Error(saveData.error || 'Could not save shipping address.');
        shippingAddressId = saveData.address.id;
      }

      // 1. Call server initiate endpoint (never passing prices/amounts)
      const res = await fetch('/api/payu/initiate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          // `expectedUnitPaise` is a display hint only: the server charges its
          // own resolved price and answers 409 when the two disagree.
          items: items.map((i) => ({
            id: i.productId || i.id,
            quantity: i.quantity,
            expectedUnitPaise: Math.round(i.price * 100),
          })),
          // Only the code is sent. The discount and the amount are computed
          // server-side inside the order transaction; `expectedTotalPaise` is
          // a comparison guard, never a charge amount.
          couponCode: checkedCoupon?.code,
          expectedTotalPaise: checkedCoupon?.totalPaise,
          customer: {
            firstname: firstName.trim(),
            email: email.trim().toLowerCase(),
            phone: cleanPhone,
          },
          shippingAddressId: shippingAddressId || undefined,
          shippingAddress: shippingAddressId ? undefined : shippingAddress,
          marketingOptIn: marketingOptInEnabled && marketingOptIn,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        // A sale started or ended while the customer was checking out. Adopt
        // the server's prices and stop: no order, no reservation, no charge.
        if (res.status === 409 && data.code === 'price_changed') {
          const updates: CartPriceUpdate[] = Array.isArray(data.items)
            ? data.items
                .filter((line: { id?: unknown }) => typeof line?.id === 'string')
                .map((line: { id: string; unitPaise: number; regularPricePaise?: number | null }) => ({
                  id: line.id,
                  unitPaise: Number(line.unitPaise),
                  regularPricePaise: line.regularPricePaise ?? null,
                }))
            : [];
          syncPrices(updates);
          setIsSubmitting(false);
          setErrorMessage('Prices have changed, please review your cart.');
          return;
        }
        // The server refused the code at Pay. The discount is already gone
        // from this page; drop the stored code too so paying again is clean.
        if (res.status === 409 && data.code === 'coupon_invalid') {
          coupon.remove();
          setIsSubmitting(false);
          setErrorMessage(data.error || 'This code is not valid for your cart.');
          return;
        }
        // Coupons could not be checked. Nothing was created and nothing is
        // charged; paying again without the code goes through normally.
        if (res.status === 409 && data.code === 'coupon_unavailable') {
          coupon.remove();
          setIsSubmitting(false);
          setErrorMessage('The coupon could not be checked. Review your total and pay again without the code.');
          return;
        }
        throw new Error(data.error || 'Failed to initiate payment.');
      }

      const { actionUrl, fields } = data;

      // 2. Build hidden HTML form with method="post" and action=PAYU_BASE_URL/_payment
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = actionUrl;
      form.style.display = 'none';

      // 3. Fill in all returned parameters
      for (const [key, val] of Object.entries(fields)) {
        if (val !== undefined && val !== null) {
          const input = document.createElement('input');
          input.type = 'hidden';
          input.name = key;
          input.value = String(val);
          form.appendChild(input);
        }
      }

      document.body.appendChild(form);

      // 4. Auto-submit form to redirect browser to PayU Hosted Checkout.
      //    The bag is deliberately NOT cleared here: the customer has not paid
      //    yet. Clearing before the gateway answers meant a blocked, failed or
      //    abandoned redirect left an empty bag behind, and the next checkout
      //    showed "This item is unavailable". The bag is cleared on the
      //    confirmed-payment page instead.
      //
      //    A blocked submission (CSP, extension, offline) leaves this page
      //    loaded, so a watchdog puts the button back and says what happened
      //    instead of spinning forever.
      window.setTimeout(() => {
        setIsSubmitting(false);
        setErrorMessage(
          'We could not reach the payment gateway. Your bag is saved — please try again.',
        );
      }, 4000);
      form.submit();
    } catch (err: unknown) {
      setIsSubmitting(false);
      setErrorMessage((err as Error).message || 'An error occurred while connecting to the payment gateway.');
    }
  };

  // Wait for the cart to hydrate before deciding: the bag is only known on the
  // client, and a stale ?productId= must not flash the unavailable panel over
  // items the customer actually has.
  if (decision.view === 'loading') {
    return (
      <div className="bg-white rounded-3xl p-6 sm:p-10 shadow-sm border border-[#e5e5ea] max-w-2xl mx-auto text-center text-sm text-[#86868b]">
        Loading your bag…
      </div>
    );
  }

  // An unknown ?productId= with an empty bag is an explicit unavailable state —
  // never a placeholder product. A non-empty bag was handled above and shows
  // the bag instead.
  if (decision.view === 'unavailable') {
    return (
      <div className="bg-white rounded-3xl p-6 sm:p-10 shadow-sm border border-[#e5e5ea] max-w-2xl mx-auto text-[#1d1d1f] text-center">
        <h1 className="text-3xl font-semibold tracking-tight">This item is unavailable</h1>
        <p className="text-sm text-[#86868b] mt-3 max-w-md mx-auto">
          The item you tried to buy isn&apos;t in our catalog. It may have been
          removed, or the link may be out of date.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/shop/iphone/accessories/cases-protection"
            className="inline-flex items-center justify-center min-h-[44px] px-6 rounded-full bg-[#0071e3] hover:bg-[#0077ed] text-white text-sm font-semibold transition"
          >
            Back to the shop
          </Link>
          <Link
            href="/cart"
            className="inline-flex items-center justify-center min-h-[44px] px-6 rounded-full border border-[#d2d2d7] text-[#1d1d1f] text-sm font-semibold hover:bg-[#f5f5f7] transition"
          >
            Review Bag
          </Link>
        </div>
      </div>
    );
  }

  // A genuinely empty bag is a different state with a different fix from an
  // unknown product. Saying "this item is unavailable" to someone whose bag is
  // simply empty sent them to "Review Bag" to look for an item that was never
  // there.
  if (decision.view === 'empty') {
    return (
      <div className="bg-white rounded-3xl p-6 sm:p-10 shadow-sm border border-[#e5e5ea] max-w-2xl mx-auto text-[#1d1d1f] text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Your bag is empty</h1>
        <p className="text-sm text-[#86868b] mt-3 max-w-md mx-auto">
          Add something to your bag before checking out. If you were part-way
          through a payment, your bag is still here — nothing was lost.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/shop/iphone/accessories/cases-protection"
            className="inline-flex items-center justify-center min-h-[44px] px-6 rounded-full bg-[#0071e3] hover:bg-[#0077ed] text-white text-sm font-semibold transition"
          >
            Back to the shop
          </Link>
          <Link
            href="/cart"
            className="inline-flex items-center justify-center min-h-[44px] px-6 rounded-full border border-[#d2d2d7] text-[#1d1d1f] text-sm font-semibold hover:bg-[#f5f5f7] transition"
          >
            Review Bag
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-3xl p-6 sm:p-10 shadow-sm border border-[#e5e5ea] max-w-2xl mx-auto text-[#1d1d1f]">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Express Checkout</h1>
        <p className="text-sm text-[#86868b] mt-1">Complete your order with PayU Hosted Checkout.</p>
      </div>

      {errorMessage && (
        <div
          role="alert"
          className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-2xl flex items-start space-x-2"
        >
          <span className="font-bold">Error:</span>
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Order Summary */}
      <div className="mb-8 p-6 bg-[#fbfbfd] rounded-2xl border border-[#e5e5ea]">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[#86868b]">Order Summary</h2>
          {bagItems.length > 0 && (
            <span className="text-xs text-[#0071e3] font-medium">{bagItems.length} {bagItems.length === 1 ? 'item' : 'items'} in Bag</span>
          )}
        </div>
        <div className="divide-y divide-[#e5e5ea]">
          {items.map((item) => {
            const isAvailable = !unavailableIds.has(item.id);
            return (
              <div key={item.id} className="py-3 flex justify-between items-center text-sm gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  {item.image && (
                    <div className="w-12 h-12 rounded-lg bg-white p-1 border border-black/5 flex items-center justify-center shrink-0">
                      <img src={item.image} alt={item.name} className="w-full h-full object-contain" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="font-medium text-[#1d1d1f] line-clamp-1">{item.name}</div>
                    <div className="text-xs text-[#86868b] flex items-center gap-2 mt-0.5">
                      <span>Qty: {item.quantity}</span>
                      {bagItems.length > 0 && (
                        <>
                          <span>•</span>
                          <button
                            type="button"
                            onClick={() => removeItem(item.id)}
                            className="text-red-600 hover:underline cursor-pointer"
                          >
                            Remove
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                {isAvailable ? (
                  <div className="font-semibold text-[#1d1d1f] shrink-0">
                    {item.regularPrice ? (
                      <s className="mr-2 font-normal text-[#86868b]">
                        ₹{(item.regularPrice * item.quantity).toLocaleString('en-IN')}
                      </s>
                    ) : null}
                    ₹{(item.price * item.quantity).toLocaleString('en-IN')}
                  </div>
                ) : (
                  <div className="font-semibold text-[#e30000] shrink-0">Unavailable</div>
                )}
              </div>
            );
          })}
        </div>
        {hasUnavailable && (
          <div
            id="checkout-unavailable-note"
            role="alert"
            className="mt-4 p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700"
          >
             {items
               .filter((item) => unavailableIds.has(item.id))
               .map((item) => item.name)
               .join(', ')} is unavailable. Remove it to continue to payment.
          </div>
        )}
        <div className="mt-4 space-y-2 border-t border-[#e5e5ea] pt-4 text-sm">
          <div className="flex justify-between text-[#86868b]">
            <span>Subtotal</span>
            <span className="font-medium text-[#1d1d1f]">
              ₹{subtotalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex justify-between text-[#86868b]">
            <span>Shipping</span>
            <span className={coupon.totals.shippingPaise > 0 ? 'font-semibold text-[#1d1d1f]' : 'font-semibold text-[#34c759]'}>
              {coupon.totals.shippingPaise > 0
                ? `₹${(coupon.totals.shippingPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                : 'FREE'}
            </span>
          </div>
          {discountAmount > 0 && (
            <div className="flex justify-between text-emerald-700">
              <span>Discount{coupon.applied ? ` (${coupon.applied.code})` : ''}</span>
              <span className="font-semibold">
                −₹{discountAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </span>
            </div>
          )}
        </div>

        {couponsEnabled && (
          <div className="py-3">
            <CouponBox coupon={coupon} compact />
          </div>
        )}

        <div className="border-t border-[#e5e5ea] pt-4 flex justify-between items-baseline font-semibold">
          <span>Total Payable</span>
          <span className="text-2xl font-bold tracking-tight text-[#1d1d1f]">
            ₹{totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </span>
        </div>
      </div>

      {/* Contact and Billing Details Form */}
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-[#86868b] mb-2">
            First Name
          </label>
          <input
            type="text"
            required
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="Rahul"
            className="w-full px-4 py-3 rounded-xl border border-[#d2d2d7] focus:outline-none focus:ring-2 focus:ring-[#0071e3] text-sm"
            disabled={isSubmitting}
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-[#86868b] mb-2">
            Email Address (for Receipt)
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="rahul@example.com"
            className="w-full px-4 py-3 rounded-xl border border-[#d2d2d7] focus:outline-none focus:ring-2 focus:ring-[#0071e3] text-sm"
            disabled={isSubmitting}
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-[#86868b] mb-2">
            10-digit Indian Mobile Number
          </label>
          <div className="flex">
            <span className="inline-flex items-center px-4 rounded-l-xl border border-r-0 border-[#d2d2d7] bg-[#f5f5f7] text-sm text-[#86868b]">
              +91
            </span>
            <input
              type="tel"
              required
              maxLength={10}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="9876543210"
              className="w-full px-4 py-3 rounded-r-xl border border-[#d2d2d7] focus:outline-none focus:ring-2 focus:ring-[#0071e3] text-sm"
              disabled={isSubmitting}
            />
          </div>
          <p className="text-xs text-[#6e6e73] mt-1">PayU will send SMS payment notifications to this number.</p>
        </div>

        <div className="pt-4">
          <fieldset className="space-y-4 rounded-2xl border border-[#e5e5ea] bg-[#fbfbfd] p-5">
            <legend className="px-1 text-sm font-semibold text-[#1d1d1f]">Shipping address</legend>
            {savedAddresses.length > 0 && (
              <div>
                <label htmlFor="saved-address" className="mb-2 block text-xs font-semibold uppercase tracking-wider text-[#86868b]">Choose a saved address</label>
                <select
                  id="saved-address"
                  value={selectedAddressId}
                  onChange={(event) => selectSavedAddress(event.target.value)}
                  className="w-full rounded-xl border border-[#d2d2d7] bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#0071e3]"
                  disabled={isSubmitting}
                >
                  <option value="">Enter a new address</option>
                  {savedAddresses.map((address) => (
                    <option key={address.id} value={address.id}>{address.name} · {address.line1}, {address.city}</option>
                  ))}
                </select>
              </div>
            )}
            {!selectedAddressId && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {([
                  ['name', 'Full name'],
                  ['phone', '10-digit phone'],
                  ['line1', 'Address line 1'],
                  ['line2', 'Address line 2 (optional)'],
                  ['city', 'City'],
                  ['state', 'State'],
                  ['pincode', '6-digit pincode'],
                ] as const).map(([field, label]) => (
                  <div key={field} className={field === 'line1' || field === 'line2' ? 'sm:col-span-2' : ''}>
                    <label htmlFor={`shipping-${field}`} className="mb-2 block text-xs font-semibold uppercase tracking-wider text-[#86868b]">{label}</label>
                    <input
                      id={`shipping-${field}`}
                      type={field === 'phone' || field === 'pincode' ? 'tel' : 'text'}
                      value={shippingAddress[field]}
                      onChange={(event) => updateShippingAddress(field, event.target.value)}
                      maxLength={field === 'phone' ? 10 : field === 'pincode' ? 6 : undefined}
                      className="w-full rounded-xl border border-[#d2d2d7] bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#0071e3]"
                      disabled={isSubmitting}
                      required={field !== 'line2'}
                    />
                  </div>
                ))}
              </div>
            )}
            {!selectedAddressId && userSession && (
              <label className="flex items-center gap-2 text-xs text-[#6e6e73]">
                <input type="checkbox" checked={saveNewAddress} onChange={(event) => setSaveNewAddress(event.target.checked)} disabled={isSubmitting} />
                Save this address to my account
              </label>
            )}
          </fieldset>

          {marketingOptInEnabled && (
            <label className="mt-4 flex items-start gap-2 rounded-2xl border border-[#e5e5ea] bg-white p-4 text-xs text-[#6e6e73]">
              <input
                type="checkbox"
                checked={marketingOptIn}
                onChange={(event) => setMarketingOptIn(event.target.checked)}
                disabled={isSubmitting}
                className="mt-0.5"
              />
              <span>Email me offers and new arrivals from Gadzio. You can unsubscribe at any time.</span>
            </label>
          )}

          <div className="pt-4">
          <button
            type="submit"
            id="payu-pay-now-btn"
            disabled={isSubmitting || hasUnavailable}
            aria-disabled={isSubmitting || hasUnavailable}
            aria-describedby={hasUnavailable ? 'checkout-unavailable-note' : undefined}
            className={`w-full py-4 rounded-full text-base font-semibold text-white transition flex items-center justify-center space-x-2 ${
              isSubmitting || hasUnavailable
                ? 'bg-[#86868b] cursor-not-allowed'
                : 'bg-[#ffe100] hover:bg-[#ffea33] active:bg-[#ffd900] text-black font-black uppercase tracking-wider active:scale-[0.99] shadow-md'
            }`}
          >
            {isSubmitting ? (
              <>
                <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span>Redirecting to PayU Secure Gateway...</span>
              </>
            ) : hasUnavailable ? (
              <span>Remove unavailable items to continue</span>
            ) : (
              <span>Pay Now with PayU • ₹{totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
            )}
          </button>
        </div>

        <div className="text-center text-xs text-[#6e6e73] pt-2">
          <span>🔒 256-bit SSL Encrypted • Card, UPI, NetBanking & Wallets via PayU</span>
          {paymentNote ? <span className="block mt-1">{paymentNote}</span> : null}
        </div>
        </div>
      </form>
    </div>
  );
}
