'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { buildWhatsAppCancelOrderUrl } from '@/lib/whatsapp';

export function OrderRequestButtons({ txnid, canCancel, canReturn }: { txnid: string; canCancel: boolean; canReturn: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submitReturn() {
    const reason = window.prompt('Why would you like to request a return?');
    if (reason === null) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/account/orders/${encodeURIComponent(txnid)}/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'return', reason }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not submit request.');
      setMessage('Your request was sent to the store team.');
      // The open request, the request list and the dashboard card all change.
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not submit request.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-[#e5e5ea] bg-white p-4">
      <div className="flex flex-wrap gap-3">
        {canCancel && (
          <a
            href={buildWhatsAppCancelOrderUrl(txnid)}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-[#d2d2d7] px-4 py-2 text-sm font-semibold text-[#1d1d1f] hover:bg-[#f5f5f7] focus:outline-none focus:ring-2 focus:ring-[#1d1d1f]"
          >
            Request cancellation
          </a>
        )}
        {canReturn && (
          <button
            type="button"
            disabled={busy}
            onClick={submitReturn}
            className="rounded-full bg-[#1d1d1f] px-4 py-2 text-sm font-semibold text-white hover:bg-black focus:outline-none focus:ring-2 focus:ring-[#1d1d1f] disabled:opacity-50"
          >
            Request return
          </button>
        )}
        <Link
          href="/return-refund"
          className="rounded-full border border-[#d2d2d7] px-4 py-2 text-sm font-semibold text-[#1d1d1f] hover:bg-[#f5f5f7] focus:outline-none focus:ring-2 focus:ring-[#1d1d1f]"
        >
          Refund
        </Link>
      </div>
      {message && <p role="alert" className="mt-3 text-sm text-[#6e6e73]">{message}</p>}
    </div>
  );
}