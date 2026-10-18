import { getPayUConfig, assertPayUConfigured } from './config';
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
  raw: Record<string, unknown> | null;
  error?: string;
}

/**
 * Calls PayU Verify Payment API to independently confirm transaction state.
 * Endpoint: POST https://test.payu.in/merchant/postservice.php?form=2 (or info.payu.in for live)
 */
export async function verifyPaymentWithPayU(
  txnid: string,
  expectedAmount: number,
): Promise<VerificationResult> {
  const config = getPayUConfig();
  assertPayUConfigured(config);

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
        raw: data,
        error: data.msg || 'Transaction details not found in PayU response.',
      };
    }

    const txnStatus = String(details.status || '').toLowerCase();
    const unmapped = String(details.unmappedstatus || '').toLowerCase();
    const payuAmt = parseFloat(details.amt || details.amount || '0');
    const mihpayid = details.mihpayid ? String(details.mihpayid) : null;
    const mode = details.mode ? String(details.mode) : null;

    // Check amount match with 0.01 tolerance for floating point representations
    const amountMatches = Math.abs(payuAmt - expectedAmount) < 0.01;
    const isSuccess = txnStatus === 'success' && unmapped === 'captured';

    return {
      verified: isSuccess && amountMatches,
      status: details.status || 'unknown',
      unmappedstatus: details.unmappedstatus || 'unknown',
      mihpayid,
      mode,
      amount: details.amt || details.amount || null,
      raw: details,
      error: !amountMatches ? `Amount mismatch: expected ${expectedAmount} but PayU returned ${payuAmt}` : undefined,
    };
  } catch (err: unknown) {
    const msg = (err as Error).message;
    console.error(`[PayU Verify] Network or fetch error for txnid=${txnid}:`, msg);
    return {
      verified: false,
      status: 'NETWORK_ERROR',
      unmappedstatus: 'NETWORK_ERROR',
      mihpayid: null,
      mode: null,
      amount: null,
      raw: null,
      error: msg,
    };
  }
}
