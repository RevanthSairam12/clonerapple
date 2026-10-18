'use client';

import React, { useState } from 'react';
import { useCart } from '@/lib/cart/CartContext';

interface CartItem {
  id: string;
  productId?: string;
  name: string;
  price: number;
  quantity: number;
  image?: string;
}

interface Props {
  initialItems?: CartItem[];
  userSession?: {
    email: string;
    firstName: string;
    lastName: string;
  } | null;
}

export function CheckoutForm({ initialItems, userSession }: Props) {
  const { items: bagItems, removeItem, clearCart } = useCart();

  const [fallbackItems] = useState<CartItem[]>(
    initialItems && initialItems.length > 0
      ? initialItems
      : [
          // Only rendered when the bag is empty. Id, name and price mirror the
          // real catalog record in
          // src/components/sites/cases-protection/data/products.ts
          // (`iphone17-silicone-black`), so the placeholder line carries a
          // product Gadzio actually sells. It previously named an Apple SKU
          // ("iPhone 17 Silicone Case with MagSafe - Black") at a price that
          // matched nothing in the catalog.
          {
            id: 'iphone17-silicone-black',
            productId: 'iphone17-silicone-black',
            name: 'Gadzio MagPulse Liquid Silicone Case (Midnight Black)',
            price: 3499,
            quantity: 1,
          },
        ]
  );

  // If items exist in the shopping bag, use the live bag!
  const items: CartItem[] =
    bagItems.length > 0
      ? bagItems.map((b) => ({
          id: b.id,
          productId: b.productId,
          name: b.name + (b.subtitle ? ` (${b.subtitle})` : ''),
          price: b.price,
          quantity: b.quantity,
          image: b.image,
        }))
      : fallbackItems;

  const [firstName, setFirstName] = useState(userSession?.firstName || '');
  const [email, setEmail] = useState(userSession?.email || '');
  const [phone, setPhone] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const totalAmount = items.reduce((acc, i) => acc + i.price * i.quantity, 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    setErrorMessage(null);

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

    // Disable the button to prevent double submission
    setIsSubmitting(true);

    try {
      // 1. Call server initiate endpoint (never passing prices/amounts)
      const res = await fetch('/api/payu/initiate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          items: items.map((i) => ({ id: i.productId || i.id, quantity: i.quantity })),
          customer: {
            firstname: firstName.trim(),
            email: email.trim().toLowerCase(),
            phone: cleanPhone,
          },
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
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

      // Clear bag before redirecting to payment
      clearCart();

      // 4. Auto-submit form to redirect browser to PayU Hosted Checkout
      form.submit();
    } catch (err: unknown) {
      setIsSubmitting(false);
      setErrorMessage((err as Error).message || 'An error occurred while connecting to the payment gateway.');
    }
  };

  return (
    <div className="bg-white rounded-3xl p-6 sm:p-10 shadow-sm border border-[#e5e5ea] max-w-2xl mx-auto text-[#1d1d1f]">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Express Checkout</h1>
        <p className="text-sm text-[#86868b] mt-1">Complete your order with PayU Hosted Checkout.</p>
      </div>

      {errorMessage && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-2xl flex items-start space-x-2">
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
          {items.map((item) => (
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
              <div className="font-semibold text-[#1d1d1f] shrink-0">
                ₹{(item.price * item.quantity).toLocaleString('en-IN')}
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-[#e5e5ea] mt-4 pt-4 flex justify-between items-baseline font-semibold">
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
          <p className="text-xs text-[#86868b] mt-1">PayU will send SMS payment notifications to this number.</p>
        </div>

        <div className="pt-4">
          <button
            type="submit"
            id="payu-pay-now-btn"
            disabled={isSubmitting}
            className={`w-full py-4 rounded-full text-base font-semibold text-white transition flex items-center justify-center space-x-2 ${
              isSubmitting
                ? 'bg-[#86868b] cursor-not-allowed'
                : 'bg-[#0071e3] hover:bg-[#0077ed] active:scale-[0.99] shadow-sm'
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
            ) : (
              <span>Pay Now with PayU • ₹{totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
            )}
          </button>
        </div>

        <div className="text-center text-xs text-[#86868b] pt-2">
          <span>🔒 256-bit SSL Encrypted • Card, UPI, NetBanking & Wallets via PayU</span>
        </div>
      </form>
    </div>
  );
}
