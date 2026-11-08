'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { BrowsingHistoryItem } from '@/lib/account/browsing-history';

interface Props {
  initialItems: BrowsingHistoryItem[];
  initialSaveHistory: boolean;
}

export function BrowsingHistoryManager({ initialItems, initialSaveHistory }: Props) {
  const router = useRouter();
  const [items, setItems] = useState<BrowsingHistoryItem[]>(initialItems);
  const [saveHistory, setSaveHistory] = useState<boolean>(initialSaveHistory);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleToggle(nextVal: boolean) {
    let clearExisting = false;
    if (!nextVal && items.length > 0) {
      clearExisting = window.confirm(
        'Turn off browsing history? Would you also like to clear your current history?',
      );
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/account/history/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ saveBrowsingHistory: nextVal, clearExisting }),
      });
      if (res.ok) {
        setSaveHistory(nextVal);
        if (clearExisting) setItems([]);
        setMessage(nextVal ? 'Browsing history is now enabled.' : 'Browsing history disabled.');
        router.refresh();
      }
    } catch {
      setMessage('Failed to update settings. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function removeItem(productId: string) {
    try {
      const res = await fetch(`/api/account/history/${encodeURIComponent(productId)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setItems((current) => current.filter((it) => it.productId !== productId));
        router.refresh();
      }
    } catch {
      setMessage('Could not remove item.');
    }
  }

  async function clearAll() {
    if (!window.confirm('Clear all browsing history?')) return;
    setBusy(true);
    try {
      const res = await fetch('/api/account/history', { method: 'DELETE' });
      if (res.ok) {
        setItems([]);
        setMessage('Browsing history cleared.');
        router.refresh();
      }
    } catch {
      setMessage('Could not clear history.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">Browsing history</h2>
          <p className="mt-1 text-sm text-[#6e6e73]">
            Products you recently viewed while signed in.
          </p>
        </div>
        {items.length > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={clearAll}
            className="text-sm font-semibold text-[#b42318] hover:underline disabled:opacity-50"
          >
            Clear all items
          </button>
        )}
      </div>

      {message && (
        <p role="alert" className="rounded-2xl bg-[#f0fdf4] p-3 text-sm text-[#166534]">
          {message}
        </p>
      )}

      <div className="rounded-3xl border border-[#e5e5ea] bg-white p-5 shadow-sm">
        <label className="flex cursor-pointer items-center justify-between gap-4">
          <div>
            <p className="font-semibold text-sm sm:text-base">Save my browsing history</p>
            <p className="text-xs sm:text-sm text-[#6e6e73]">
              When disabled, new product views are not recorded.
            </p>
          </div>
          <input
            type="checkbox"
            checked={saveHistory}
            disabled={busy}
            onChange={(e) => void handleToggle(e.target.checked)}
            className="h-5 w-5 rounded border-[#d2d2d7] text-[#1d1d1f] focus:ring-[#1d1d1f]"
          />
        </label>
      </div>

      {items.length === 0 ? (
        <div className="rounded-3xl border border-[#e5e5ea] bg-white p-8 text-center shadow-sm">
          <p className="text-sm text-[#6e6e73]">No products in your browsing history.</p>
          <Link
            href="/shop/iphone/accessories/cases-protection"
            className="mt-4 inline-flex rounded-full bg-[#ffe100] px-5 py-2.5 text-sm font-bold text-[#1d1d1f] hover:bg-[#ffea33] focus:outline-none focus:ring-2 focus:ring-[#1d1d1f]"
          >
            Explore products
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <article
              key={item.id}
              className="flex flex-col justify-between rounded-3xl border border-[#e5e5ea] bg-white p-4 shadow-sm"
            >
              <div className="flex gap-4">
                <Link
                  href={item.href}
                  className="h-20 w-20 shrink-0 rounded-2xl bg-[#f5f5f7] p-2 focus:outline-none focus:ring-2 focus:ring-[#1d1d1f]"
                >
                  {item.image ? (
                    <img src={item.image} alt="" className="h-full w-full object-contain" />
                  ) : (
                    <div className="h-full w-full" />
                  )}
                </Link>
                <div className="min-w-0 flex-1">
                  <Link
                    href={item.href}
                    className="block font-semibold text-sm hover:underline line-clamp-2"
                  >
                    {item.name}
                  </Link>
                  <p className="mt-1 text-xs text-[#6e6e73]">{item.subtitle}</p>
                  <p className="mt-1 text-sm font-semibold">{item.priceDisplay}</p>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-[#f5f5f7] pt-3 text-xs text-[#6e6e73]">
                <span>Viewed {item.viewCount} time{item.viewCount === 1 ? '' : 's'}</span>
                <button
                  type="button"
                  onClick={() => removeItem(item.productId)}
                  className="font-semibold text-[#b42318] hover:underline"
                >
                  Remove
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
