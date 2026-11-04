'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

export function RequestBillForm({ txnid, reasons }: { txnid: string; reasons: Array<{ id: string; label: string }> }) {
  const router = useRouter();
  const [reasonId, setReasonId] = useState('');
  const [otherText, setOtherText] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const isOther = reasonId === 'other';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError('');
    setPending(true);
    try {
      const response = await fetch(`/api/account/orders/${encodeURIComponent(txnid)}/bill-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reasonId, ...(isOther ? { otherText: otherText.trim() } : {}) }),
      });
      if (!response.ok) {
        setError('We could not request this bill. Check your reason and try again, or refresh the order for its latest status.');
        return;
      }
      router.push(`/account/orders/${encodeURIComponent(txnid)}/receipt`);
      router.refresh();
    } catch {
      setError('The bill request could not be sent. Please try again.');
    } finally {
      setPending(false);
    }
  }

  return <section className="rounded-3xl border border-[#e5e5ea] bg-white p-5 shadow-sm">
    <h3 className="font-semibold">Request bill / payment receipt</h3>
    <p className="mt-2 text-sm text-[#6e6e73]">Before shipment, select a reason to request a provisional bill. The permanent invoice follows on shipment.</p>
    <form onSubmit={submit} className="mt-4 space-y-4">
      <label className="block text-sm font-semibold">Reason
        <select required disabled={pending} value={reasonId} onChange={(event) => setReasonId(event.target.value)} className="mt-2 block w-full rounded-xl border border-[#d2d2d7] bg-white p-3 font-normal">
          <option value="">Select a reason</option>
          {reasons.map((reason) => <option key={reason.id} value={reason.id}>{reason.label}</option>)}
        </select>
      </label>
      {isOther && <label className="block text-sm font-semibold">Other reason
        <textarea required maxLength={300} disabled={pending} value={otherText} onChange={(event) => setOtherText(event.target.value)} className="mt-2 block w-full rounded-xl border border-[#d2d2d7] p-3 font-normal" rows={3} />
      </label>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {reasons.length === 0 && <p className="text-sm text-[#6e6e73]">Bill request reasons are temporarily unavailable. Please try again later.</p>}
      <button disabled={pending || !reasonId || (isOther && !otherText.trim())} className="rounded-full bg-[#0071e3] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{pending ? 'Requesting…' : 'Request and view bill'}</button>
    </form>
  </section>;
}
