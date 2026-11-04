/** Only accept the reservation endpoint's exact, relative status link shape. */
export function safePaymentStatusUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/order/status?') || /[\s\\#]/.test(value)) return null;
  const query = value.slice('/order/status?'.length);
  // Reject extra/duplicate parameters rather than silently dropping them.
  if (!/^txnid=[^&?=]+$/.test(query)) return null;
  try {
    const txnid = decodeURIComponent(query.slice('txnid='.length));
    if (!txnid.trim() || /[\u0000-\u001f\u007f]/.test(txnid)) return null;
    return `/order/status?txnid=${encodeURIComponent(txnid)}`;
  } catch {
    return null;
  }
}

/** Only the endpoint's effective order status, not a gateway claim, confirms payment. */
export function isConfirmedRecoveryPayment(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const result = value as Record<string, unknown>;
  return result.ok === true && result.status === 'PAID';
}

/** Retry-After may be seconds or an HTTP date. No automatic retry is scheduled. */
export function paymentRetryAfterSeconds(value: string | null, now = Date.now()): number {
  if (!value?.trim()) return 30;
  const seconds = /^\d+$/.test(value.trim())
    ? Number(value)
    : (Date.parse(value) - now) / 1000;
  return Number.isFinite(seconds) ? Math.max(1, Math.ceil(seconds)) : 30;
}
