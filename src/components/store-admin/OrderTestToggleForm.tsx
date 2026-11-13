'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Props {
  txnid: string;
  isTest: boolean;
  testNote: string;
  testMarkedAt: string | null;
}

/**
 * Owner-only control to mark or unmark an order as a test order.
 * Marked orders stay intact (no deletes or renumbering) and are excluded from
 * revenue, overview, customers, and reports.
 */
export function OrderTestToggleForm({ txnid, isTest, testNote, testMarkedAt }: Props) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const nextIsTest = !isTest;
  const actionLabel = nextIsTest ? 'Mark as test order' : 'Unmark test order';

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      setError('Give a reason of at least 3 characters.');
      return;
    }

    setBusy(true);
    setError('');
    setNotice('');

    try {
      const res = await fetch(
        `/api/store-admin/orders/${encodeURIComponent(txnid)}/test-order`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isTest: nextIsTest, reason: trimmed }),
        },
      );

      const json = (await res.json().catch(() => ({}))) as {
        isTest?: boolean;
        error?: string;
      };

      if (!res.ok) {
        setError(json.error ?? 'Could not update test-order status.');
        return;
      }

      setReason('');
      setNotice(
        json.isTest
          ? 'Marked as a test order. Excluded from revenue, overview, customers, and reports.'
          : 'Unmarked as a test order. Included in revenue, overview, customers, and reports again.',
      );
      router.refresh();
    } catch {
      setError('Network error — please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sa-detail-card">
      <h3 className="sa-card-title">Test order classification</h3>
      <p className="sa-note">
        {isTest
          ? 'This order is currently marked as a test order and excluded from revenue, overview, customers, and reports. Nothing was deleted or renumbered.'
          : 'Mark sandbox or internal QA orders so they are excluded from revenue, overview, customers, and reports without deleting or renumbering any row.'}
      </p>
      {isTest && (testNote || testMarkedAt) ? (
        <p className="sa-lock-note">
          {testNote ? `Note: ${testNote}` : 'Marked as test order'}
          {testMarkedAt ? ` · ${new Date(testMarkedAt).toLocaleString('en-IN')}` : ''}
        </p>
      ) : null}

      <form className="sa-reveal" onSubmit={handleSubmit}>
        <label className="sa-label" htmlFor="test-order-reason">
          Audit reason (required)
        </label>
        <input
          id="test-order-reason"
          className="sa-input"
          type="text"
          name="reason"
          required
          minLength={3}
          maxLength={200}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={nextIsTest ? 'e.g. Pre-launch QA PayU test order' : 'e.g. Marked in error; genuine customer order'}
          disabled={busy}
        />

        {error ? (
          <p className="sa-error" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="sa-note" role="status">
            {notice}
          </p>
        ) : null}

        <button
          type="submit"
          className={nextIsTest ? 'sa-btn sa-btn-quiet' : 'sa-btn sa-btn-primary'}
          disabled={busy}
        >
          {busy ? 'Saving…' : actionLabel}
        </button>
      </form>
    </div>
  );
}

