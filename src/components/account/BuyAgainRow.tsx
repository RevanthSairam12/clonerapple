'use client';

import { useState } from 'react';
import Link from 'next/link';

import { useCart } from '@/lib/cart/CartContext';
import { stockBlocked } from '@/lib/storefront/availability-rules';
import type { BuyAgainItem } from '@/lib/account/orders';

type RowProps = {
  items: BuyAgainItem[];
  /** The sale switch as the server read it for this request. */
  saleLive: boolean;
};

/**
 * Sellable past purchases, priced by the same resolver every storefront
 * surface uses. The Add to Bag press re-reads the owner-scoped endpoint first,
 * so a price or stock change since the page rendered is respected and the
 * cart never receives a stale price.
 */
export function BuyAgainRow({ items, saleLive }: RowProps) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="buy-again-heading" className="rounded-3xl border border-[#e5e5ea] bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="buy-again-heading" className="text-lg font-semibold">Buy again</h2>
          <p className="mt-1 text-sm text-[#6e6e73]">Items you bought before, at today&apos;s price and stock.</p>
        </div>
        <Link href="/account/orders" className="text-sm font-semibold text-[#0071e3] hover:underline">
          Your orders
        </Link>
      </div>
      <ul className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <li key={item.id}>
            <BuyAgainCard item={item} saleLive={saleLive} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function BuyAgainCard({ item, saleLive }: { item: BuyAgainItem; saleLive: boolean }) {
  const { addItem } = useCart();
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const blocked = stockBlocked(item.inStock, saleLive);

  async function add() {
    if (blocked || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/account/buy-again/${encodeURIComponent(item.id)}`,
        { cache: 'no-store' },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.product) {
        setNotice(body?.error || 'That item is no longer available to reorder.');
        return;
      }
      const current = body.product as BuyAgainItem;
      if (stockBlocked(current.inStock, saleLive)) {
        setNotice('Stock not available right now.');
        return;
      }
      addItem({
        productId: current.id,
        name: current.name,
        subtitle: current.subtitle,
        price: current.pricePaise / 100,
        priceDisplay: current.priceDisplay,
        regularPrice: current.onSale ? current.regularPricePaise / 100 : undefined,
        wasPriceDisplay: current.wasPriceDisplay ?? undefined,
        image: current.image,
        quantity: 1,
        href: current.href,
      });
      setAdded(true);
      window.setTimeout(() => setAdded(false), 2500);
    } catch {
      setNotice('Could not add this item. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="flex h-full gap-3 rounded-2xl border border-[#e5e5ea] p-3">
      <Link href={item.href} className="shrink-0 rounded-xl bg-[#f5f5f7] p-2 focus:outline-none focus:ring-2 focus:ring-[#0071e3]">
        {item.image
          ? <img src={item.image} alt="" className="h-16 w-16 object-contain" loading="lazy" />
          : <span className="block h-16 w-16" aria-hidden="true" />}
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={item.href} className="block truncate text-sm font-semibold hover:text-[#0071e3] focus:outline-none focus:ring-2 focus:ring-[#0071e3]">
          {item.name}
        </Link>
        <p className="mt-0.5 text-xs text-[#6e6e73]">
          Last ordered {item.lastOrderedAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
        </p>
        <p className="mt-1 text-sm font-semibold">
          {item.wasPriceDisplay && <s className="mr-1.5 text-xs font-normal text-[#86868b]">{item.wasPriceDisplay}</s>}
          {item.priceDisplay}
        </p>
        <div className="mt-2">
          {blocked ? (
            <span className="text-xs font-semibold text-[#6e6e73]">Sold out</span>
          ) : (
            <button
              type="button"
              onClick={add}
              disabled={busy}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-[#0071e3] disabled:opacity-50 ${
                added ? 'bg-[#34c759] text-white' : 'bg-[#f5f5f7] text-[#1d1d1f] hover:bg-[#0071e3] hover:text-white'
              }`}
            >
              {added ? 'Added to bag ✓' : busy ? 'Checking…' : 'Add to bag'}
            </button>
          )}
        </div>
        {notice && <p role="alert" className="mt-2 text-xs text-[#b42318]">{notice}</p>}
      </div>
    </article>
  );
}