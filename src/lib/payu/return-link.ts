/**
 * Short-lived signed links for the post-payment return.
 *
 * PayU sends the customer back to a callback route. On a mobile browser, or
 * after a redirect chain, the session cookie can be missing — and the old
 * result pages then showed "Access Denied" for the customer's own order.
 *
 * The callback route therefore appends a signed token to the result URL. The
 * token proves only one thing: "these callback handlers just settled this
 * order reference". It unlocks a safe summary (order number, status, amount),
 * never the full order: items, address, email and payment identifiers still
 * require the signed-in owner.
 *
 * Fail closed: with no `PAYU_RETURN_SECRET` no token is issued and the pages
 * keep the sign-in requirement. The token is an HMAC-SHA256 of
 * `v1|<txnid>|<expiry>` under that secret; it carries no personal data.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** How long a return link stays usable. Long enough for a slow bank redirect. */
export const RETURN_TOKEN_TTL_SECONDS = 30 * 60;

/** Reject tokens issued with an implausible clock; guards a forged `exp`. */
const MAX_TOKEN_LIFETIME_SECONDS = 24 * 60 * 60;

function secret(): string | null {
  const value = (process.env.PAYU_RETURN_SECRET || '').trim();
  return value.length >= 32 ? value : null;
}

function sign(txnid: string, expiry: number, key: string): string {
  return createHmac('sha256', key)
    .update(`v1|${txnid}|${expiry}`)
    .digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    // Compare anyway so the timing does not reveal the length mismatch.
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

/**
 * Issue a token for `txnid`, or null when signing is not configured.
 * Callers must treat null as "serve the signed-in-only page".
 */
export function issueReturnToken(
  txnid: string,
  now: Date = new Date(),
): string | null {
  const key = secret();
  const reference = txnid.trim();
  if (!key || !reference) return null;
  const expiry = Math.floor(now.getTime() / 1000) + RETURN_TOKEN_TTL_SECONDS;
  return `${expiry}.${sign(reference, expiry, key)}`;
}

/** Verify a token from the query string. Any malformed input is simply false. */
export function verifyReturnToken(
  txnid: string | null | undefined,
  token: string | null | undefined,
  now: Date = new Date(),
): boolean {
  const key = secret();
  const reference = (txnid || '').trim();
  const raw = (token || '').trim();
  if (!key || !reference || !raw) return false;

  const dot = raw.indexOf('.');
  if (dot <= 0 || dot === raw.length - 1) return false;

  const expiryText = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);
  if (!/^\d{1,12}$/.test(expiryText)) return false;

  const expiry = Number(expiryText);
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (!Number.isSafeInteger(expiry)) return false;
  if (expiry <= nowSeconds) return false;
  if (expiry - nowSeconds > MAX_TOKEN_LIFETIME_SECONDS) return false;

  return safeEqual(signature, sign(reference, expiry, key));
}

/**
 * Append `rt=<token>` to an order-result path. Returns the path unchanged when
 * signing is not configured, so the page falls back to the session check.
 */
export function appendReturnToken(
  pathAndQuery: string,
  txnid: string,
  now: Date = new Date(),
): string {
  const token = issueReturnToken(txnid, now);
  if (!token) return pathAndQuery;
  const separator = pathAndQuery.includes('?') ? '&' : '?';
  return `${pathAndQuery}${separator}rt=${encodeURIComponent(token)}`;
}
