/**
 * Gate for the post-payment result pages.
 *
 * A customer who has just paid may return without a session cookie: a mobile
 * browser, an in-app bank webview or a redirect chain can drop it. The callback
 * route therefore appends a short-lived signed `rt` token to the result URL.
 *
 * The rule the pages apply:
 *
 *   * the signed-in owner sees the full order;
 *   * a valid `rt` token sees a safe summary — order
 *     number, status, amount — and nothing else;
 *   * everyone else sees the sign-in prompt.
 *
 * The token is checked here, on the server, against `PAYU_RETURN_SECRET`. With
 * no secret configured no token verifies, so the pages fall back to requiring
 * a session. Fail closed.
 */

import { verifyReturnToken } from './return-link';

export interface ReturnAccessInput {
  txnid: string;
  token: string | null | undefined;
  userId: string | null;
  sessionUserId: string | null;
}

export type ReturnAccess = 'owner' | 'summary';

/**
 * Decide how much of an order the visitor may see.
 *
 * Guest orders also require a valid signed token. An unguessable reference
 * is not authentication; a missing signing secret fails closed.
 */
export function resolveReturnAccess(input: ReturnAccessInput): ReturnAccess | null {
  const session = (input.sessionUserId || '').trim();
  if (input.userId && session && session === input.userId) return 'owner';
  return verifyReturnToken(input.txnid, input.token) ? 'summary' : null;
}

/** Add `?rt=` to a same-site escape link so a summary visitor keeps access. */
export function carryReturnToken(href: string, token: string | null | undefined): string {
  const raw = (token || '').trim();
  if (!raw) return href;
  const separator = href.includes('?') ? '&' : '?';
  return `${href}${separator}rt=${encodeURIComponent(raw)}`;
}
