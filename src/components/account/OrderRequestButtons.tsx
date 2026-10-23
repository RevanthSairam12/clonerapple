'use client';

import { useState } from 'react';

export function OrderRequestButtons({ txnid, canCancel, canReturn }: { txnid: string; canCancel: boolean; canReturn: boolean }) {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(type: 'cancel' | 'return') {
    const reason = window.prompt(type === 'cancel' ? 'Why would you like to request cancellation?' : 'Why would you like to request a return?');
    if (reason === null) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/account/orders/${encodeURIComponent(txnid)}/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, reason }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not submit request.');
      setMessage('Your request was sent to the store team.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not submit request.');
    } finally {
      setBusy(false);
    }
  }

  if (!canCancel && !canReturn && !message) return null;
  return (
    <div className="rounded-2xl border border-[#e5e5ea] bg-white p-4">
      <div className="flex flex-wrap gap-3">
        {canCancel && <button type="button" disabled={busy} onClick={() => submit('cancel')} className="rounded-full border border-[#d2d2d7] px-4 py-2 text-sm font-semibold hover:bg-[#f5f5f7] disabled:opacity-50">Request cancellation</button>}
        {canReturn && <button type="button" disabled={busy} onClick={() => submit('return')} className="rounded-full bg-[#1d1d1f] px-4 py-2 text-sm font-semibold text-white hover:bg-black disabled:opacity-50">Request return</button>}
      </div>
      {message && <p role="alert" className="mt-3 text-sm text-[#6e6e73]">{message}</p>}
    </div>
  );
}
