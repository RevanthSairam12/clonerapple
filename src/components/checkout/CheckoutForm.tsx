'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useCart, type CartPriceUpdate } from '@/lib/cart/CartContext';
import { priceCartLines, baseProductId, parsePriceChangedQuote, quoteMatchesLines, applyQuotePrices, shippingNudge, createQuoteGeneration, type PriceChangedQuote, type SaleRefreshClock, type PriceRef } from '@/lib/checkout/client-quote';
import { useCheckoutRefresh } from '@/lib/checkout/useCheckoutRefresh';
import { safePaymentStatusUrl } from '@/lib/checkout/payment-recovery';
import { verifyAvailabilityLines } from '@/lib/storefront/use-availability';
import { getCartLineBaseId } from '@/lib/cart/cart-id';
import { decideCheckoutView } from '@/lib/checkout/checkout-decision';
import {
  quoteShipping,
  type ShippingPolicy,
} from '@/lib/checkout/shipping-rules';
import { useCoupon } from '@/lib/cart/useCoupon';
import { CouponBox } from '@/components/cart/CouponBox';
import { INDIAN_STATES, normalizeIndianMobile, normalizeIndianState, validateCheckoutContact, validateIndianAddress, checkoutFieldErrors, type CheckoutField, type FieldErrors } from '@/lib/checkout/india-validation';
import { formatRupees } from '@/lib/store-admin/money';

interface CartItem {
  id: string;
  productId?: string;
  variantId?: string;
  variantSku?: string;
  variantLabel?: string;
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
  shippingPolicy: ShippingPolicy | null;
  initialProducts: PriceRef[];
  saleClock?: SaleRefreshClock;
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

export function CheckoutForm({ initialItems, userSession, productUnavailable = false, productIdFromQuery, marketingOptInEnabled = false, shippingPolicy: serverPolicy, initialProducts, saleClock, paymentNote = '', saleLive = false, couponsEnabled = true }: Props) {
  const { items: bagItems, removeItem, syncPrices, isHydrated } = useCart();
  useCheckoutRefresh(saleClock);
  const [recovery, setRecovery] = useState<{ key: string; quote: PriceChangedQuote; couponCode: string | null } | null>(null);
  const [quoteUnavailable, setQuoteUnavailable] = useState(false);
  const [selectionConflict, setSelectionConflict] = useState<{ id: string; name: string; variantLabel?: string } | null>(null);
  const quoteGeneration = React.useRef(createQuoteGeneration());
  React.useEffect(() => () => quoteGeneration.current.invalidate(), []);

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

  const sourceItems: CartItem[] =
    decision.view === 'bag'
      ? bagItems.map((b) => ({
          id: b.id,
          productId: b.productId,
          variantId: b.variantId, variantSku: b.variantSku, variantLabel: b.variantLabel,
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

  const sourceKey = JSON.stringify({ lines: sourceItems.map((item) => [baseProductId(item), item.variantId || null, item.quantity]), products: initialProducts, serverPolicy, saleLive });
  const activeRecovery = !selectionConflict && recovery?.key === sourceKey ? recovery : null;
  const shippingPolicy = activeRecovery?.quote.shippingPolicy ?? serverPolicy;
  const products = activeRecovery ? applyQuotePrices(initialProducts, activeRecovery.quote) : initialProducts;
  // Both bag and direct-buy lines use live integer-paise catalogue prices.
  const items = priceCartLines(sourceItems, products, saleLive);
  const unavailableIds = new Set(items.filter((item) => !item.available).map((item) => item.id));
  const hasUnavailable = unavailableIds.size > 0;
  const payableItems = items.filter((item) => item.available);

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
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [addressNotice, setAddressNotice] = useState('');
  const uncertainAddressSave = React.useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeReservation, setActiveReservation] = useState<{ statusUrl: string | null; expiresAt: string | null } | null>(null);
  const [marketingOptIn, setMarketingOptIn] = useState(false);

  React.useEffect(() => {
    fetch('/api/account/addresses')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const addresses = Array.isArray(data?.addresses) ? data.addresses : [];
        setSavedAddresses(addresses);
        const preferred = addresses.find((address: SavedAddress) => address.isDefault) || addresses[0];
        if (preferred) {
          const valid = validateIndianAddress(preferred);
          setSelectedAddressId(valid.ok ? preferred.id : '');
          if (!valid.ok) setAddressNotice('Please correct this saved address before paying. Your saved address has not been changed.');
          setShippingAddress({
            name: preferred.name,
            phone: preferred.phone,
            line1: preferred.line1,
            line2: preferred.line2 || '',
            city: preferred.city,
            state: normalizeIndianState(preferred.state) || preferred.state,
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
    const selected = savedAddresses.find((address) => address.id === id);
    setFieldErrors({});
    setAddressNotice('');
    if (!selected) {
      setSelectedAddressId('');
      setShippingAddress({ name: firstName, phone, line1: '', line2: '', city: '', state: '', pincode: '' });
      return;
    }
    const valid = validateIndianAddress(selected);
    setSelectedAddressId(valid.ok ? id : '');
    if (!valid.ok) setAddressNotice('Please correct this saved address before paying. Your saved address has not been changed.');
    setShippingAddress({ ...selected, line2: selected.line2 || '', state: normalizeIndianState(selected.state) || selected.state });
    setPhone(normalizeIndianMobile(selected.phone));
  };
  const addressForCheckout = {
    ...shippingAddress,
    name: selectedAddressId ? shippingAddress.name : firstName,
    phone,
  };
  const contactForCheckout = { firstname: firstName, email, phone };
  const validateField = (field: CheckoutField) => {
    const errors = checkoutFieldErrors(contactForCheckout, addressForCheckout);
    setFieldErrors(current => ({ ...current, [field]: errors[field] }));
    if (field === 'phone') setPhone(normalizeIndianMobile(phone));
  };
  const errorFor = (field: CheckoutField) => fieldErrors[field] ? <p id={`checkout-${field}-error`} className="mt-1 text-sm text-red-700" role="alert">{fieldErrors[field]}</p> : null;
  const fieldProps = (field: CheckoutField) => ({
    id: `checkout-${field}`, name: field,
    'aria-invalid': Boolean(fieldErrors[field]),
    'aria-describedby': fieldErrors[field] ? `checkout-${field}-error` : undefined,
    onBlur: () => validateField(field),
  });

  const subtotalPaise = payableItems.reduce((sum, item) => sum + item.totalPaise, 0);
  const subtotalAmount = subtotalPaise / 100;
  const shippingPaise = shippingPolicy ? quoteShipping(subtotalPaise, shippingPolicy).shippingPaise : 0;
  const coupon = useCoupon({
    items: payableItems.map((item) => ({ id: baseProductId(item), variantId: item.variantId, quantity: item.quantity, unitPaise: item.unitPaise })),
    subtotalPaise, shippingPaise,
    policySignature: JSON.stringify(shippingPolicy),
    email,
    enabled: Boolean(shippingPolicy) && couponsEnabled && payableItems.length > 0,
  });
  const recoveredTotals = activeRecovery && activeRecovery.couponCode === coupon.appliedCode &&
    (!activeRecovery.couponCode || coupon.input.trim().toUpperCase() === activeRecovery.couponCode)
    ? activeRecovery.quote.totals : null;
  const totals = coupon.applied ? coupon.totals : recoveredTotals ?? coupon.totals;
  const discountAmount = totals.discountPaise / 100;
  const totalAmount = totals.totalPaise / 100;
  const nudge = shippingNudge(subtotalPaise, shippingPolicy, totals.shippingPaise);
  const paymentUnavailable = !shippingPolicy || quoteUnavailable;
  const currentSignature = JSON.stringify({ sourceKey, shippingPolicy, items: items.map((item) => [item.id, item.quantity, item.unitPaise]), code: coupon.input, total: totals.totalPaise });
  const latestSignature = React.useRef(currentSignature);
  latestSignature.current = currentSignature;
  quoteGeneration.current.update(currentSignature);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || activeReservation || selectionConflict) return;
    if (paymentUnavailable) {
      setErrorMessage('Shipping rates are unavailable. Refresh the page before paying.');
      return;
    }
    const acceptedTotalPaise = totals.totalPaise;
    const acceptedSignature = currentSignature;
    const quoteTicket = quoteGeneration.current.capture();

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

    const contactValidation = validateCheckoutContact(contactForCheckout);
    const addressValidation = validateIndianAddress(addressForCheckout);
    const errors = checkoutFieldErrors(contactForCheckout, addressForCheckout);
    setFieldErrors(errors);
    if (!contactValidation.ok || !addressValidation.ok) {
      const field = Object.keys(errors)[0];
      document.getElementById(`checkout-${field}`)?.focus();
      return;
    }
    const cleanPhone = contactValidation.value.phone;
    const normalizedAddress = addressValidation.value;

    // Disable the button to prevent double submission
    setIsSubmitting(true);

    try {
      const stockValid = await verifyAvailabilityLines(items.map((item) => ({ productId: baseProductId(item), variantId: item.variantId, quantity: item.quantity })));
      if (stockValid !== true) {
        setIsSubmitting(false);
        setErrorMessage(stockValid === false ? 'Stock not available for the selected quantity. Review your bag.' : 'Could not verify stock. Please try again.');
        return;
      }
      // Re-check the code against the cart as it stands right now. If it no
      // longer holds, nothing is sent: the customer must see the new total
      // before paying instead of being charged something they did not agree to.
      const checkedCoupon = couponsEnabled ? await coupon.revalidate() : null;
      if (couponsEnabled && coupon.appliedCode && !checkedCoupon) {
        setIsSubmitting(false);
        setErrorMessage('The coupon was removed. Please review your updated total and pay again.');
        return;
      }

      if ((checkedCoupon && checkedCoupon.totalPaise !== acceptedTotalPaise) || latestSignature.current !== acceptedSignature || !quoteGeneration.current.current(quoteTicket)) {
        setRecovery(null);
        setIsSubmitting(false);
        setErrorMessage('Your order total has changed. Please review the updated total and pay again.');
        return;
      }

      let shippingAddressId = selectedAddressId;
      // A response can be lost after the server saves. Recover the owned row
      // before another insert, rather than creating a duplicate on Pay retry.
      if (!shippingAddressId && saveNewAddress && userSession && uncertainAddressSave.current) {
        const response = await fetch('/api/account/addresses');
        if (!response.ok) throw new Error('Could not check whether your address was saved. Uncheck Save this address to continue without saving.');
        const data = await response.json();
        const match = (Array.isArray(data.addresses) ? data.addresses : []).find((entry: SavedAddress) => {
          const checked = validateIndianAddress(entry);
          return checked.ok && (Object.keys(normalizedAddress) as Array<keyof typeof normalizedAddress>).every(key => checked.value[key] === normalizedAddress[key]);
        });
        if (match) {
          shippingAddressId = match.id;
          setSelectedAddressId(match.id);
          setSavedAddresses(data.addresses);
        } else {
          throw new Error('The previous save could not be confirmed. Uncheck Save this address to continue; your order address will still be included.');
        }
        uncertainAddressSave.current = false;
      }
      // Guests have no address book; the address rides along with the order.
      if (!shippingAddressId && saveNewAddress && userSession) {
        uncertainAddressSave.current = true;
        const saveResponse = await fetch('/api/account/addresses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...normalizedAddress, isDefault: savedAddresses.length === 0 }),
        });
        const saveData = await saveResponse.json();
        if (!saveResponse.ok) {
          uncertainAddressSave.current = false;
          throw new Error(saveData.error || 'Could not save shipping address. Uncheck Save this address to pay without saving it.');
        }
        shippingAddressId = saveData.address.id;
        uncertainAddressSave.current = false;
        setSelectedAddressId(shippingAddressId);
        setShippingAddress(normalizedAddress);
        setSavedAddresses(current => [...current.filter(address => address.id !== shippingAddressId), { ...normalizedAddress, id: shippingAddressId, isDefault: current.length === 0 }]);
      }

      if (latestSignature.current !== acceptedSignature || !quoteGeneration.current.current(quoteTicket)) {
        setIsSubmitting(false);
        setErrorMessage('Your order changed. Please review it before paying.');
        return;
      }
      // Displayed prices and total are comparison guards, never charge amounts.
      const res = await fetch('/api/payu/initiate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          // `expectedUnitPaise` is a display hint only: the server charges its
          // own resolved price and answers 409 when the two disagree.
          items: items.map((i) => ({
            id: baseProductId(i),
            variantId: i.variantId,
            quantity: i.quantity,
            expectedUnitPaise: i.unitPaise,
          })),
          // Only the code is sent. The discount and the amount are computed
          // server-side inside the order transaction; `expectedTotalPaise` is
          // a comparison guard, never a charge amount.
          couponCode: checkedCoupon?.code,
          expectedTotalPaise: acceptedTotalPaise,
          customer: {
            firstname: firstName.trim(),
            email: email.trim().toLowerCase(),
            phone: cleanPhone,
          },
          shippingAddressId: shippingAddressId || undefined,
          shippingAddress: shippingAddressId ? undefined : normalizedAddress,
          marketingOptIn: marketingOptInEnabled && marketingOptIn,
        }),
      });

      const data = await res.json();
      // Never adopt an old quote (including A → B → A), or submit a gateway
      // form after the selection changed or this checkout was invalidated.
      if (!quoteGeneration.current.current(quoteTicket)) {
        setRecovery(null);
        setIsSubmitting(false);
        setErrorMessage('Your order changed. Review your bag before continuing.');
        return;
      }
      if (!res.ok || !data.success) {
        if (res.status === 409 && data.code === 'selection_unavailable') {
          const selected = sourceItems.find((item) => baseProductId(item) === data.selection?.id &&
            (item.variantId || null) === (data.selection?.variantId ?? null));
          quoteGeneration.current.invalidate();
          setRecovery(null);
          setSelectionConflict({
            id: selected ? baseProductId(selected) : '',
            name: selected?.name || 'An item in your order',
            variantLabel: selected?.variantLabel || selected?.variantId,
          });
          setIsSubmitting(false);
          setErrorMessage(null);
          return;
        }
        if (res.status === 400 && data.fieldErrors) {
          const { name: recipientError, ...apiErrors } = data.fieldErrors;
          const visibleErrors: FieldErrors = { ...apiErrors, ...(recipientError ? { firstname: recipientError } : {}) };
          setFieldErrors(visibleErrors);
          if (data.code === 'address_needs_correction') setSelectedAddressId('');
          setIsSubmitting(false);
          document.getElementById(`checkout-${Object.keys(visibleErrors)[0]}`)?.focus();
          return;
        }
        if (res.status === 409 && data.code === 'already_paid') {
          const redirectUrl = typeof data.redirectUrl === 'string' && /^\/order\/success\?txnid=[^&?#]+(&recovery=1)?$/.test(data.redirectUrl)
            ? data.redirectUrl
            : safePaymentStatusUrl(data.statusUrl);
          setIsSubmitting(false);
          if (redirectUrl && typeof window !== 'undefined') {
            window.location.assign(redirectUrl);
            return;
          }
          setErrorMessage('Your previous payment has already been confirmed. View your orders to see the receipt.');
          return;
        }
        if (res.status === 409 && data.code === 'verification_unavailable') {
          setIsSubmitting(false);
          setErrorMessage(data.error || 'We could not confirm your previous payment yet. Please try again in a minute.');
          return;
        }
        if (res.status === 409 && data.code === 'reservation_active') {
          const expiresAt = typeof data.reservationExpiresAt === 'string' && Number.isFinite(Date.parse(data.reservationExpiresAt))
            ? new Date(data.reservationExpiresAt).toISOString() : null;
          setActiveReservation({ statusUrl: safePaymentStatusUrl(data.statusUrl), expiresAt });
          setIsSubmitting(false);
          setErrorMessage(null);
          return;
        }
        // A sale started or ended while the customer was checking out. Adopt
        // the server's prices and stop: no order, no reservation, no charge.
        if (res.status === 409 && data.code === 'price_changed') {
          const quote = parsePriceChangedQuote(data);
          if (!quote || !quoteMatchesLines(quote, sourceItems)) {
            setQuoteUnavailable(true);
            setIsSubmitting(false);
            setErrorMessage('Updated pricing is unavailable. Refresh the page before paying.');
            return;
          }
          const updates: CartPriceUpdate[] = quote.items.map((line) => ({
            id: line.id, variantId: line.variantId, unitPaise: line.unitPaise, regularPricePaise: line.regularPricePaise,
          }));
          setRecovery({ key: sourceKey, quote, couponCode: checkedCoupon?.code ?? null });
          syncPrices(updates);
          setIsSubmitting(false);
          setErrorMessage('Prices or shipping have changed. Please review your updated order total and pay again.');
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
      <div className="bg-white rounded-3xl p-6 sm:p-10 shadow-sm border border-[#e5e5ea] max-w-2xl mx-auto text-center text-sm text-[#6e6e73]">
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
        <p className="text-sm text-[#6e6e73] mt-3 max-w-md mx-auto">
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
        <p className="text-sm text-[#6e6e73] mt-3 max-w-md mx-auto">
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
    <div className="mx-auto max-w-6xl text-[#1d1d1f]">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Checkout</h1>
        <p className="text-sm text-[#6e6e73] mt-1">Review your order and enter your delivery details.</p>
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

      {selectionConflict && (
        <section role="alert" className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">{selectionConflict.name}{selectionConflict.variantLabel ? ` — ${selectionConflict.variantLabel}` : ''} is no longer available.</p>
          <p className="mt-2">No payment was started. Your bag is unchanged. Review the affected selection or choose options before returning to checkout.</p>
          <div className="mt-3 flex flex-wrap gap-4">
            <Link href="/cart" className="font-semibold text-[#0071e3] hover:underline">Review bag</Link>
            {selectionConflict.id && <Link href={`/shop/product/${encodeURIComponent(selectionConflict.id)}`} className="font-semibold text-[#0071e3] hover:underline">Choose options</Link>}
          </div>
        </section>
      )}

      {activeReservation && (
        <section role="status" className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">A checkout is already in progress.</p>
          <p className="mt-2">No new payment was started. Your current bag is kept. Check the existing payment before trying another checkout. If your bank shows a debit, do not pay again.</p>
          {activeReservation.expiresAt && (
            <p className="mt-2">Reservation expiry: <time dateTime={activeReservation.expiresAt}>{new Date(activeReservation.expiresAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</time>. Expiry alone does not confirm whether a payment was taken.</p>
          )}
          {activeReservation.statusUrl ? (
            <Link href={activeReservation.statusUrl} prefetch={false} className="mt-3 inline-block font-semibold text-[#0071e3] hover:underline">View existing payment status</Link>
          ) : (
            <Link href="/account/orders" prefetch={false} className="mt-3 inline-block font-semibold text-[#0071e3] hover:underline">Find the checkout in your orders</Link>
          )}
          <p className="mt-2">After resolving the existing checkout, refresh this page to review your bag before starting a new payment.</p>
        </section>
      )}

      <div className="grid min-w-0 grid-cols-1 items-start gap-6 lg:grid-cols-2 lg:gap-10">
      <section aria-label="Order summary" className="min-w-0 rounded-2xl border border-[#d2d2d7] bg-white p-5 sm:p-6 lg:sticky lg:top-28">
        <button type="button" aria-expanded={summaryOpen} aria-controls="checkout-summary-details" onClick={() => setSummaryOpen(open => !open)} className="flex w-full items-center justify-between gap-3 text-left font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0066cc] lg:hidden">
          <span>Order summary <span aria-hidden="true">{summaryOpen ? '−' : '+'}</span></span>
          <span>{paymentUnavailable ? 'Unavailable' : formatRupees(totals.totalPaise)}</span>
        </button>
        <div id="checkout-summary-details" className={`${summaryOpen ? 'block' : 'hidden'} pt-4 lg:block lg:pt-0`}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[#6e6e73]">Order Summary</h2>
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
                      <img src={item.image} alt="" width={48} height={48} className="w-full h-full object-contain" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="font-medium text-[#1d1d1f] break-words">{item.name}</div>
                    {item.variantLabel && <p className="mt-1 text-xs text-[#6e6e73]">{item.variantLabel}</p>}
                    <div className="text-xs text-[#6e6e73] flex items-center gap-2 mt-0.5">
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
                      <s className="mr-2 font-normal text-[#6e6e73]">
                        ₹{(item.regularPrice * item.quantity).toLocaleString('en-IN')}
                      </s>
                    ) : null}
                    ₹{(item.totalPaise / 100).toLocaleString('en-IN')}
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
          <div className="flex justify-between text-[#6e6e73]">
            <span>Subtotal</span>
            <span className="font-medium text-[#1d1d1f]">
              ₹{subtotalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex justify-between text-[#6e6e73]">
            <span>Shipping</span>
            <span className={totals.shippingPaise > 0 ? 'font-semibold text-[#1d1d1f]' : 'font-semibold text-[#34c759]'}>
              {totals.shippingPaise > 0
                ? `₹${(totals.shippingPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
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

        {nudge && <p className="py-3 text-xs text-[#6e6e73]">{nudge}</p>}
        {paymentUnavailable && <p role="alert" className="py-3 text-sm text-red-700">Shipping rates are temporarily unavailable. Refresh the page before paying.</p>}
        {!paymentUnavailable && couponsEnabled && (
          <div className="py-3">
            <CouponBox coupon={coupon} compact />
          </div>
        )}

        <div className="border-t border-[#e5e5ea] pt-4 flex justify-between items-baseline font-semibold">
          <span>Total Payable</span>
          <span className="text-2xl font-bold tracking-tight text-[#1d1d1f]">
            {paymentUnavailable ? 'Unavailable' : `₹${totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`}
          </span>
        </div>
        </div>
      </section>

      <form onSubmit={handleSubmit} noValidate className="min-w-0 space-y-5 rounded-2xl border border-[#d2d2d7] bg-white p-5 sm:p-6">
        <h2 className="text-xl font-semibold">Your details</h2>
        <div>
          <label htmlFor="checkout-firstname" className="block text-sm font-semibold text-[#333336] mb-2">
            First name
          </label>
          <input
            {...fieldProps('firstname')}
            type="text"
            autoComplete="given-name"
            required
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="Rahul"
            className="w-full px-4 py-3 rounded-xl border border-[#d2d2d7] focus:outline-none focus:ring-2 focus:ring-[#0071e3] text-sm"
            disabled={isSubmitting}
          />
          {errorFor('firstname')}
        </div>

        <div>
          <label htmlFor="checkout-email" className="block text-sm font-semibold text-[#333336] mb-2">
            Email address (for receipt)
          </label>
          <input
            {...fieldProps('email')}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="rahul@example.com"
            className="w-full px-4 py-3 rounded-xl border border-[#d2d2d7] focus:outline-none focus:ring-2 focus:ring-[#0071e3] text-sm"
            disabled={isSubmitting}
          />
          {errorFor('email')}
        </div>

        <div>
          <label htmlFor="checkout-phone" className="block text-sm font-semibold text-[#333336] mb-2">
            Mobile number
          </label>
          <div className="flex">
            <span className="inline-flex items-center px-4 rounded-l-xl border border-r-0 border-[#d2d2d7] bg-[#f5f5f7] text-sm text-[#6e6e73]">
              +91
            </span>
            <input
              {...fieldProps('phone')}
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              required
              value={phone}
              onChange={(e) => {
                const value = normalizeIndianMobile(e.target.value);
                setPhone(value);
                if (selectedAddressId) {
                  setSelectedAddressId('');
                  setShippingAddress(current => ({ ...current, phone: value }));
                }
              }}
              placeholder="9876543210"
              className="w-full px-4 py-3 rounded-r-xl border border-[#d2d2d7] focus:outline-none focus:ring-2 focus:ring-[#0071e3] text-sm"
              disabled={isSubmitting}
            />
          </div>
          {errorFor('phone')}
          <p className="text-xs text-[#6e6e73] mt-1">Enter 10 digits. You can also paste a number starting with +91.</p>
        </div>

        <div className="pt-4">
          <fieldset className="space-y-4 rounded-2xl border border-[#e5e5ea] bg-[#fbfbfd] p-5">
            <legend className="px-1 text-sm font-semibold text-[#1d1d1f]">Shipping address</legend>
            {savedAddresses.length > 0 && (
              <div>
                <label htmlFor="saved-address" className="mb-2 block text-xs font-semibold uppercase tracking-wider text-[#6e6e73]">Choose a saved address</label>
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
            {addressNotice && <p role="status" className="text-sm text-amber-900">{addressNotice}</p>}
            {selectedAddressId && <p className="text-sm text-[#333336]">Delivering to <strong>{shippingAddress.name}</strong>. Editing an address creates a new checkout snapshot; it does not change your saved address.</p>}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {([
                ['line1', 'House or flat and street', 'address-line1'],
                ['line2', 'Area or landmark (optional)', 'address-line2'],
                ['city', 'City', 'address-level2'],
                ['state', 'State or union territory', 'address-level1'],
                ['pincode', 'PIN code', 'postal-code'],
              ] as const).map(([field, label, autoComplete]) => (
                <div key={field} className={field === 'line1' || field === 'line2' ? 'sm:col-span-2' : 'min-w-0'}>
                  <label htmlFor={`checkout-${field}`} className="mb-2 block text-sm font-semibold text-[#333336]">{label}</label>
                  {field === 'state' ? <select {...fieldProps(field)} autoComplete={autoComplete} value={shippingAddress.state} onChange={event => updateShippingAddress(field, event.target.value)} disabled={isSubmitting} required className="w-full rounded-xl border border-[#d2d2d7] bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#0071e3]">
                    <option value="">Choose a state or union territory</option>
                    {INDIAN_STATES.map(state => <option key={state} value={state}>{state}</option>)}
                  </select> : <input {...fieldProps(field)} type="text" inputMode={field === 'pincode' ? 'numeric' : undefined} autoComplete={autoComplete} value={shippingAddress[field]} onChange={event => updateShippingAddress(field, event.target.value)} className="w-full rounded-xl border border-[#d2d2d7] bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#0071e3]" disabled={isSubmitting} required={field !== 'line2'} />}
                  {errorFor(field)}
                </div>
              ))}
            </div>
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
            id="checkout-pay-now-btn"
            disabled={isSubmitting || Boolean(activeReservation) || Boolean(selectionConflict) || hasUnavailable || paymentUnavailable || coupon.busy}
            aria-disabled={isSubmitting || Boolean(activeReservation) || Boolean(selectionConflict) || hasUnavailable || paymentUnavailable || coupon.busy}
            aria-describedby={hasUnavailable ? 'checkout-unavailable-note' : undefined}
            className={`w-full py-4 rounded-full text-base font-semibold transition flex items-center justify-center space-x-2 ${
              isSubmitting || Boolean(activeReservation) || Boolean(selectionConflict) || hasUnavailable || paymentUnavailable || coupon.busy
                ? 'bg-[#6e6e73] text-white cursor-not-allowed'
                : 'bg-[#ffe100] hover:bg-[#ffea33] active:bg-[#ffd900] text-black font-black uppercase tracking-wider active:scale-[0.99] shadow-md'
            }`}
          >
            {isSubmitting ? (
              <>
                <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span>Opening secure payment…</span>
              </>
            ) : selectionConflict ? (
              <span>Review your selection before paying</span>
            ) : activeReservation ? (
              <span>Check your existing payment first</span>
            ) : paymentUnavailable ? (
              <span>Checkout temporarily unavailable</span>
            ) : hasUnavailable ? (
              <span>Remove unavailable items to continue</span>
            ) : (
              <span>Pay Rs {totalAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
            )}
          </button>
        </div>

        <div className="text-center text-xs text-[#6e6e73] pt-2">
          <span>Secure online payment</span>
          {paymentNote && !/payu/i.test(paymentNote) ? <span className="block mt-1">{paymentNote}</span> : null}
        </div>
        </div>
      </form>
      </div>
    </div>
  );
}
