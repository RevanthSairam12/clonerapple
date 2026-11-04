'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isConfirmedRecoveryPayment, paymentRetryAfterSeconds } from '@/lib/checkout/payment-recovery';

export function CheckPaymentButton({ txnid }: { txnid: string }) {
  const router = useRouter();
  const checking = useRef(false);
  const retryAt = useRef(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function checkPayment() {
    if (checking.current) return;
    if (Date.now() < retryAt.current) {
      setMessage(`Please wait ${Math.ceil((retryAt.current - Date.now()) / 1000)} seconds before checking again. This does not start another payment.`);
      return;
    }
    checking.current = true;
    setBusy(true);
    setMessage('Checking this payment. Please do not pay again.');
    try {
      const response = await fetch(`/api/account/orders/${encodeURIComponent(txnid)}/verify`, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
      });
      if (!response.ok) {
        if (response.status === 429) {
          const seconds = paymentRetryAfterSeconds(response.headers.get('Retry-After'));
          retryAt.current = Date.now() + seconds * 1000;
          setMessage(`Please wait ${seconds} seconds before checking again. Your payment has not been confirmed here; do not pay again if your bank shows a debit.`);
        } else if (response.status === 401) {
          setMessage('Please sign in with the account that placed this order, then check again. No new payment was started.');
        } else if (response.status === 404) {
          setMessage('This payment is not available for your account. Contact support if your bank shows a debit; do not pay again.');
        } else if (response.status === 409) {
          setMessage('This payment cannot be checked right now. Review the order status or contact support before paying again.');
        } else {
          setMessage('Payment verification is temporarily unavailable. Try checking again later. If your bank shows a debit, please do not pay again.');
        }
        return;
      }
      const result: unknown = await response.json();
      if (isConfirmedRecoveryPayment(result)) {
        router.push(`/order/success?txnid=${encodeURIComponent(txnid)}&recovery=1`);
        return;
      }
      const retryable = result && typeof result === 'object' && 'retryable' in result ? result.retryable : undefined;
      setMessage(retryable === false
        ? 'Payment has not been confirmed. Review the order status or contact support before paying again, especially if your bank shows a debit.'
        : 'Payment has not been confirmed yet. You can check again later. If your bank shows a debit, please do not pay again.');
    } catch {
      setMessage('We could not confirm the payment. Please check again later. If your bank shows a debit, do not pay again.');
    } finally {
      checking.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={checkPayment}
        disabled={busy}
        className="w-full rounded-full bg-[#ffe100] px-6 py-3.5 text-sm font-semibold text-black transition hover:bg-[#ffea33] disabled:cursor-wait disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0071e3]"
      >
        {busy ? 'Checking payment…' : 'Check payment status'}
      </button>
      <p role="status" aria-live="polite" className="text-sm leading-relaxed text-[#6e6e73]">
        {message || 'Checks this payment only. No new charge is started and your current bag is kept.'}
      </p>
    </div>
  );
}
