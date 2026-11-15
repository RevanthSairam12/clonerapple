'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

export interface OrderSerialNumbersFormProps {
  txnid: string;
  paymentStatus: string;
  fulfilmentStatus: string;
  invoiceNumber: string | null;
  items: Array<{
    lineNumber: number;
    productName: string;
    variantLabel?: string | null;
    quantity: number;
    serialNumber?: string | null;
  }>;
  canEdit: boolean;
}

export function OrderSerialNumbersForm({
  txnid,
  paymentStatus,
  fulfilmentStatus,
  invoiceNumber,
  items,
  canEdit,
}: OrderSerialNumbersFormProps) {
  const router = useRouter();
  const [values, setValues] = useState<Record<number, string>>(() => {
    const initial: Record<number, string> = {};
    for (const item of items) {
      initial[item.lineNumber] = item.serialNumber ?? '';
    }
    return initial;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  if (items.length === 0) return null;

  const isPaid = paymentStatus.toUpperCase() === 'PAID';
  const isCancelled = ['CANCELED', 'CANCELLED'].includes(fulfilmentStatus.toUpperCase());
  const blockedReason = !isPaid
    ? 'Payment must be settled (PAID) before saving serial numbers and generating an invoice.'
    : isCancelled
      ? 'Serial numbers and invoices cannot be generated for a canceled order.'
      : '';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit || busy || blockedReason) return;
    setError('');
    setNotice('');
    setBusy(true);

    try {
      const response = await fetch(
        `/api/store-admin/orders/${encodeURIComponent(txnid)}/serial-numbers`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            serialNumbers: items.map((item) => ({
              lineNumber: item.lineNumber,
              serialNumber: values[item.lineNumber] ?? '',
            })),
          }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || 'Could not save serial numbers.');
        return;
      }
      setNotice(
        data.invoiceNumber
          ? `Serial numbers saved. Invoice ${data.invoiceNumber} generated.`
          : 'Serial numbers saved.',
      );
      router.refresh();
    } catch {
      setError('Could not save serial numbers. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="sa-detail-card mt-5">
      <h2 className="sa-card-title">Product serial numbers &amp; invoice generation</h2>
      <p className="sa-note">
        Enter a serial number for every product in this order. Saving serial numbers for all
        products generates the invoice and prints the serial number on each product line.
      </p>
      {invoiceNumber ? (
        <p className="sa-notice" role="status">
          Invoice generated: <strong className="sa-mono">{invoiceNumber}</strong>
        </p>
      ) : null}
      {blockedReason ? <p className="sa-lock-note">{blockedReason}</p> : null}

      <form onSubmit={handleSubmit} className="mt-4 space-y-3">
        {items.map((item) => {
          const inputId = `serial-line-${item.lineNumber}`;
          return (
            <div key={item.lineNumber}>
              <label htmlFor={inputId} className="block text-sm font-semibold">
                {item.lineNumber}. {item.productName}
                {item.variantLabel ? ` (${item.variantLabel})` : ''} · Qty {item.quantity}
              </label>
              <input
                id={inputId}
                type="text"
                maxLength={120}
                required
                disabled={!canEdit || busy || Boolean(blockedReason)}
                value={values[item.lineNumber] ?? ''}
                onChange={(event) =>
                  setValues((prev) => ({
                    ...prev,
                    [item.lineNumber]: event.target.value,
                  }))
                }
                placeholder="Enter serial number"
                className="sa-input mt-1 w-full"
              />
            </div>
          );
        })}

        {error ? <p role="alert" className="sa-error">{error}</p> : null}
        {notice ? <p role="status" className="sa-notice">{notice}</p> : null}

        {canEdit ? (
          <button
            type="submit"
            disabled={busy || Boolean(blockedReason)}
            className="sa-btn sa-btn-primary"
          >
            {busy ? 'Saving…' : invoiceNumber ? 'Update serial numbers' : 'Save serial numbers & generate invoice'}
          </button>
        ) : (
          <p className="sa-lock-note">Viewer access is read-only.</p>
        )}
      </form>
    </section>
  );
}
