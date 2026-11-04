import { parseRupeesToPaise } from '@/lib/store-admin/money';

import { getPayUConfig, assertPayUCredentialsConfigured } from './config';
import { generateVerifyPaymentHash } from './hash';

/**
 * PayU Server-to-Server Payment Verification API client
 * 
 * Verifies transaction validity directly with PayU servers before marking an order as PAID.
 * Protects against spoofed client-side POST returns.
 */

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: PayU payment verification must never run in browser code.');
}

export interface VerificationResult {
  verified: boolean;
  status: string;
  unmappedstatus: string;
  mihpayid: string | null;
  mode: string | null;
  amount: string | null;
  /** Amount PayU reported, in integer paise (null when absent or unparseable). */
  amountPaise: number | null;
  raw: Record<string, unknown> | null;
  error?: string;
}

/** Only operational facts, never gateway prose, identifiers, credentials or PII. */
export function safePaymentSummary(payload: Record<string, unknown> | null | undefined): Record<string, string | number> {
  const safe: Record<string, string | number> = {};
  const statuses = new Set(['success', 'failure', 'failed', 'pending', 'captured', 'usercancelled',
    'cancelled', 'canceled', 'pending_payment', 'auth', 'initiated', 'in progress', 'dropped',
    'bounced', 'not_found', 'unknown', 'network_error', 'http_error', 'parse_error', 'no_record']);
  for (const field of ['status', 'unmappedstatus']) {
    const value = typeof payload?.[field] === 'string' ? payload[field].trim().toLowerCase() : '';
    if (statuses.has(value)) safe[field] = value;
  }
  const mode = typeof payload?.mode === 'string' ? payload.mode.trim().toUpperCase() : '';
  if (['CC', 'DC', 'NB', 'UPI', 'CASH', 'EMI', 'WALLET', 'PAYU', 'BNPL'].includes(mode)) safe.mode = mode;
  const amount = parseRupeesToPaise(payload?.amt ?? payload?.amount);
  if (amount.ok && amount.paise !== null && Number.isSafeInteger(amount.paise)) safe.amountPaise = amount.paise;
  else if (Number.isSafeInteger(payload?.amountPaise) && Number(payload?.amountPaise) >= 0) safe.amountPaise = Number(payload?.amountPaise);
  if (typeof payload?.currency === 'string' && payload.currency.trim().toUpperCase() === 'INR') safe.currency = 'INR';
  return safe;
}

export interface PaymentIntegrityOrder {
  txnid: string;
  amount: number;
  totalPaise: number;
  currency: string;
  payuMihpayid: string | null;
  items: Array<{ name: string; quantity: number }>;
}

export interface PaymentIntegrityMismatch { code: string; detail: string }

/** Same checks for browser/webhook, staff/customer checks and reconciliation. */
export function checkPaymentIntegrity(
  order: PaymentIntegrityOrder,
  evidence: Record<string, unknown>,
  requireAmount = false,
): PaymentIntegrityMismatch | null {
  const text = (value: unknown) => String(value ?? '').trim();
  const mismatch = (code: string): PaymentIntegrityMismatch => ({
    code, detail: `Gateway evidence failed the ${code} integrity check.`,
  });
  if (text(evidence.txnid) && text(evidence.txnid) !== order.txnid) return mismatch('txnid_mismatch');
  const amount = evidence.amt ?? evidence.amount;
  const hasAmount = amount !== null && amount !== undefined && text(amount) !== '';
  if (hasAmount || requireAmount) {
    const parsed = parseRupeesToPaise(amount);
    if (!parsed.ok) return mismatch('amount_unreadable');
    const expected = Number.isSafeInteger(order.totalPaise) ? order.totalPaise : Math.round(order.amount * 100);
    if (parsed.paise !== expected) return mismatch('amount_mismatch');
  }
  const currency = text(evidence.currency).toUpperCase();
  if (currency && currency !== (order.currency || 'INR').toUpperCase()) return mismatch('currency_mismatch');
  const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (text(evidence.productinfo)) {
    const expected = normalise(order.items.map((item) => `${item.name} (x${item.quantity})`).join(', '));
    const received = normalise(text(evidence.productinfo));
    if (expected && (!received || (!expected.startsWith(received) && !received.startsWith(expected)))) {
      return mismatch('productinfo_mismatch');
    }
  }
  const gatewayId = text(evidence.mihpayid);
  if (gatewayId && order.payuMihpayid && gatewayId !== order.payuMihpayid) return mismatch('gateway_identity_mismatch');
  return null;
}

/** Include returned fields, not order-derived placeholders, in the shared check. */
export function checkVerificationIntegrity(
  order: PaymentIntegrityOrder,
  result: VerificationResult | null,
): PaymentIntegrityMismatch | null {
  if (!result) return null;
  const rawMismatch = checkPaymentIntegrity(order, result.raw ?? {});
  if (rawMismatch) return rawMismatch;
  const expectedPaise = Number.isSafeInteger(order.totalPaise) ? order.totalPaise : Math.round(order.amount * 100);
  if (result.amountPaise !== null && result.amountPaise !== expectedPaise) {
    return { code: 'amount_mismatch', detail: 'Gateway amount does not match the order.' };
  }
  if (result.raw?.mihpayid && result.mihpayid && String(result.raw.mihpayid).trim() !== result.mihpayid) {
    return { code: 'gateway_identity_mismatch', detail: 'Gateway payment identities disagree.' };
  }
  return checkPaymentIntegrity(order, { amount: result.amount, mihpayid: result.mihpayid }, result.verified);
}

/**
 * Calls PayU Verify Payment API to independently confirm transaction state.
 * Endpoint: POST https://test.payu.in/merchant/postservice.php?form=2 (or info.payu.in for live)
 *
 * `expectedAmount` is in rupees, matching `orders.amount`. The comparison is
 * done in integer paise so a float representation can never make two
 * different amounts compare equal.
 */
export async function verifyPaymentWithPayU(
  txnid: string,
  expectedAmount: number,
): Promise<VerificationResult> {
  const config = getPayUConfig();
  assertPayUCredentialsConfigured(config);

  const command = 'verify_payment';
  const hash = generateVerifyPaymentHash(config.key, command, txnid, config.salt);

  const formBody = new URLSearchParams();
  formBody.append('key', config.key);
  formBody.append('command', command);
  formBody.append('var1', txnid);
  formBody.append('hash', hash);

  try {
    const res = await fetch(config.verifyPaymentUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formBody.toString(),
      signal: AbortSignal.timeout(15000), // 15s timeout
    });

    if (!res.ok) {
      return {
        verified: false,
        status: 'UNKNOWN',
        unmappedstatus: 'HTTP_ERROR',
        mihpayid: null,
        mode: null,
        amount: null,
        amountPaise: null,
        raw: null,
        error: `PayU verify endpoint responded with HTTP ${res.status}`,
      };
    }

    const data = await res.json().catch(() => null);
    if (!data || typeof data !== 'object') {
      return {
        verified: false,
        status: 'UNKNOWN',
        unmappedstatus: 'PARSE_ERROR',
        mihpayid: null,
        mode: null,
        amount: null,
        amountPaise: null,
        raw: null,
        error: 'Failed to parse JSON from PayU Verify Payment API.',
      };
    }

    // Response contains status and transaction_details keyed by txnid
    const details = data.transaction_details?.[txnid];
    if (!details) {
      return {
        verified: false,
        status: data.status === 0 ? 'NOT_FOUND' : 'UNKNOWN',
        unmappedstatus: 'NO_RECORD',
        mihpayid: null,
        mode: null,
        amount: null,
        amountPaise: null,
        raw: data,
        error: 'Transaction details not found in PayU response.',
      };
    }

    const txnStatus = String(details.status || '').toLowerCase();
    const unmapped = String(details.unmappedstatus || '').toLowerCase();
    const rawAmount = details.amt ?? details.amount ?? null;
    const parsedAmount = parseRupeesToPaise(rawAmount);
    const payuPaise = parsedAmount.ok ? parsedAmount.paise : null;
    const mihpayid = details.mihpayid ? String(details.mihpayid) : null;
    const mode = details.mode ? String(details.mode) : null;

    // Integer paise on both sides: `order.amount` is a rupee NUMERIC, so it is
    // converted with the same parser the admin money fields use.
    const expectedPaise = Math.round(Number(expectedAmount) * 100);
    const amountMatches = payuPaise !== null && payuPaise === expectedPaise;
    const transactionMatches = !details.txnid || String(details.txnid).trim() === txnid;
    const isSuccess = txnStatus === 'success' && unmapped === 'captured';

    return {
      verified: isSuccess && amountMatches && transactionMatches,
      status: details.status || 'unknown',
      unmappedstatus: details.unmappedstatus || 'unknown',
      mihpayid,
      mode,
      amount: rawAmount === null ? null : String(rawAmount),
      amountPaise: payuPaise,
      raw: details,
      error: !amountMatches
        ? `Amount mismatch: expected ${expectedPaise} paise but PayU returned ${
            payuPaise === null ? 'an unreadable amount' : `${payuPaise} paise`
          }`
        : undefined,
    };
  } catch {
    const msg = 'Gateway verification unavailable.';
    console.error('[PayU Verify] Gateway verification unavailable.');
    return {
      verified: false,
      status: 'NETWORK_ERROR',
      unmappedstatus: 'NETWORK_ERROR',
      mihpayid: null,
      mode: null,
      amount: null,
      amountPaise: null,
      raw: null,
      error: msg,
    };
  }
}
