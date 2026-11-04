/**
 * The one HTTP handler behind `surl`, `furl` and `curl`.
 *
 * PayU sends the customer's browser back with a form POST (some flows use a
 * GET redirect). Every branch of this handler answers the same way:
 *
 *   * a 303 See Other to an absolute URL on the validated site base — so the
 *     browser repeats the request as a GET and the payment is never re-posted;
 *   * when the site base is missing or invalid, a small plain page that says
 *     the payment was recorded and where to check it. Never a blank page, a
 *     stack trace, a raw gateway response or a redirect to an unvalidated host.
 */

import { NextRequest, NextResponse } from 'next/server';

import { resolveAppBaseUrl } from './config';
import { verifyReturnToken } from './return-link';
import {
  processPayUCallback,
  type CallbackOptions,
  type PayUResponseData,
  type ProcessResult,
} from './process-response';

export const CALLBACK_RUNTIME = 'nodejs';
export const CALLBACK_DYNAMIC = 'force-dynamic';

function copyParams(target: PayUResponseData, params: URLSearchParams): void {
  for (const [key, value] of params.entries()) {
    if (!(key in target)) target[key] = value;
  }
}

async function readBody(request: NextRequest): Promise<PayUResponseData> {
  const data: PayUResponseData = {};
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD') return data;

  const contentType = (request.headers.get('content-type') || '').toLowerCase();

  const readForm = async (): Promise<boolean> => {
    try {
      const formData = await request.formData();
      for (const [key, value] of formData.entries()) {
        data[key] = typeof value === 'string' ? value : value.name;
      }
      return true;
    } catch {
      return false;
    }
  };

  try {
    if (contentType.includes('application/json')) {
      const json = await request.json().catch(() => null);
      if (json && typeof json === 'object' && !Array.isArray(json)) {
        for (const [key, value] of Object.entries(json as Record<string, unknown>)) {
          if (typeof value === 'string' || typeof value === 'number') {
            data[key] = String(value);
          }
        }
      }
      return data;
    }

    if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
      await readForm();
      return data;
    }

    // No declared content type: try a form body, then a raw urlencoded one.
    if (await readForm()) return data;

    const text = await request.text().catch(() => '');
    if (text && text.includes('=')) copyParams(data, new URLSearchParams(text));
  } catch {
    // A malformed body is treated as an empty callback: the processor answers
    // with a safe page instead of an exception.
  }

  return data;
}

/**
 * Read the callback values from a form POST, a JSON POST, a raw urlencoded body
 * or (for gateways that use a redirect) the query string.
 *
 * The body wins over the query string: a value appended to the return URL must
 * never override what PayU actually sent (and signed). Values stay strings —
 * the reverse hash is computed over the exact characters received.
 */
export async function readCallbackData(request: NextRequest): Promise<PayUResponseData> {
  const data = await readBody(request);
  copyParams(data, request.nextUrl.searchParams);
  return data;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * A safe fallback when there is no validated site address to redirect to.
 * It names the configuration gap in operator terms and no payment detail.
 */
function plainResultPage(result: ProcessResult, reason: string): NextResponse {
  const heading = result.status === 'PAID'
    ? 'Payment received'
    : result.status === 'CANCELLED'
      ? 'Payment cancelled'
      : result.status === 'PROCESSING' || result.status === 'PENDING'
        ? 'Payment is being verified'
        : 'Payment could not be completed';

  const reference = result.txnid
    ? `<p>Reference: <strong>${escapeHtml(result.txnid)}</strong></p>`
    : '';

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(heading)}</title>
<style>
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; background: #f5f5f7; color: #1d1d1f; }
  main { max-width: 34rem; margin: 12vh auto; padding: 2rem; background: #fff; border-radius: 18px; box-shadow: 0 8px 30px rgba(0,0,0,.08); }
  h1 { font-size: 1.4rem; margin: 0 0 .75rem; }
  p { line-height: 1.5; color: #424245; }
  small { display: block; margin-top: 1.5rem; color: #86868b; }
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(heading)}</h1>
  <p>Open the store and check “Orders” for the latest payment status. If you may have been charged, do not pay again while verification is pending.</p>
  ${reference}
  <p><small>${escapeHtml(reason)}</small></p>
</main>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex',
    },
  });
}

/**
 * Process a PayU browser return and answer with a 303.
 *
 * PayU cannot reach a redirect built from an unvalidated `Host` header, and an
 * absolute URL on a dead tunnel is exactly the "site can't be reached" failure
 * this handler exists to prevent. So the address comes only from
 * `APP_BASE_URL`; when it is unusable the handler still records the payment
 * and shows the plain page.
 */
export async function handlePayUCallback(
  request: NextRequest,
  options: CallbackOptions = {},
): Promise<NextResponse> {
  let result: ProcessResult;
  let data: PayUResponseData = {};

  try {
    data = await readCallbackData(request);
    result = await processPayUCallback(data, 'redirect', options);
  } catch {
    console.error('[PayU Callback] could not process a return; outcome remains uncertain.');
    const base = resolveAppBaseUrl();
    const txnid = typeof data.txnid === 'string' ? data.txnid.trim() : '';
    if (base.ok) {
      const destination = new URL('/order/status?error=verification_unavailable', base.baseUrl);
      if (txnid) destination.searchParams.set('txnid', txnid);
      // Do not mint access from an unprocessed/untrusted callback. Only carry
      // an already valid signed token; otherwise the status page requires ownership.
      const token = request.nextUrl.searchParams.get('rt');
      if (verifyReturnToken(txnid, token)) destination.searchParams.set('rt', token!);
      return NextResponse.redirect(destination, { status: 303 });
    }
    return plainResultPage(
      {
        ok: false,
        rejected: true,
        retryable: true,
        status: 'PROCESSING',
        txnid,
        order: null,
        redirectUrl: null,
      },
      'Online payment is not configured yet.',
    );
  }

  if (result.redirectUrl) {
    return NextResponse.redirect(new URL(result.redirectUrl), { status: 303 });
  }

  // The order was still processed above; only the return address is missing.
  const base = resolveAppBaseUrl();
  return plainResultPage(result, base.ok ? 'The result page could not be built.' : base.message);
}
