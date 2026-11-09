import type postgres from 'postgres';

import { getSql } from '@/lib/platform/db';
import { getOrderByTxnid } from '@/lib/payu/orders';
import { VERIFICATION_CLAIM_REASON } from '@/lib/payu/payment-events';
import {
  verifyExistingOrderWithPayU,
  verifyOrderWithPayU,
  type CallbackOptions,
  type PaymentVerifier,
} from '@/lib/payu/process-response';
import { checkRateLimit } from '@/lib/payu/rate-limit';
import { writeAudit } from '@/lib/store-admin/audit';

export const ORDER_VERIFY_COOLDOWN_SECONDS = 15;
export const ACTOR_VERIFY_WINDOW_SECONDS = 60;
export const ACTOR_VERIFY_MAX_PER_WINDOW = 10;

const VERIFY_ADVISORY_NAMESPACE = 41020;

const dependencies = {
  getOrderByTxnid,
  verifyExistingOrderWithPayU,
  verifyOrderWithPayU,
  checkRateLimit,
  writeAudit,
};

export interface VerificationDependencies {
  getOrderByTxnid: typeof getOrderByTxnid;
  verifyExistingOrderWithPayU: typeof verifyExistingOrderWithPayU;
  verifyOrderWithPayU?: typeof verifyOrderWithPayU;
  checkRateLimit: typeof checkRateLimit;
  writeAudit: typeof writeAudit;
  /** Optional database client for multi-instance and concurrency tests. */
  sql?: postgres.Sql | null;
  /** Optional S2S verifier override passed through to verifyExistingOrderWithPayU. */
  verifier?: PaymentVerifier;
  /** Optional clock override (ISO string, Date, or epoch ms) for deterministic cooldown expiry tests. */
  now?: Date | string | number;
  /** Disable side-effect notifications/cache invalidation in isolated schema tests. */
  sideEffects?: boolean;
}

export type VerificationClaimResult =
  | { kind: 'not_found' }
  | { kind: 'already_paid'; orderId: string; txnid: string }
  | { kind: 'rate_limited'; retryAfterSec: number; reason: 'order_cooldown' | 'actor_limit' }
  | { kind: 'claimed'; orderId: string; txnid: string };

/**
 * Atomically claim the right to call PayU `verify_payment` for an order.
 *
 * Runs inside a short PostgreSQL transaction that commits BEFORE the outbound
 * PayU HTTP request:
 *   1. Acquires a transaction-scoped advisory lock for the actor (`userId` or `adminId`)
 *      and an exclusive `FOR UPDATE` row lock on `orders` for `txnid`.
 *   2. Verifies order existence and (for customer checks) ownership (`user_id = actorId`).
 *   3. Short-circuits with `already_paid` if `orders.status = 'PAID'` so settled
 *      orders never call PayU again.
 *   4. Checks `payment_events` under the row lock for any verification claim or
 *      result on this order within the last 15 seconds (enforcing both the 15s
 *      per-order cooldown and a bounded 15s lease so a crashed/timed-out
 *      serverless invocation recovers automatically after 15 seconds).
 *   5. Checks the actor's 10-requests-per-60-seconds budget in `payment_events`.
 *   6. Inserts a `verification_claim_lease` row into `payment_events` and commits.
 */
export async function claimPaymentVerificationInDb(
  sql: postgres.Sql,
  input: {
    txnid: string;
    source: 'customer' | 'admin';
    actorId: string;
    now?: Date | string | number;
  },
): Promise<VerificationClaimResult> {
  const key = input.txnid.trim();
  const actorTag = `claim:${input.actorId.trim().slice(0, 60)}`;
  const nowIso =
    input.now !== undefined ? new Date(input.now).toISOString() : null;

  return sql.begin(async (tx) => {
    await tx`
      select pg_advisory_xact_lock(
        ${VERIFY_ADVISORY_NAMESPACE},
        hashtext(${`${input.source}:${input.actorId}`})
      )
    `;

    const orderRows = (await tx`
      select id, txnid, user_id, status
      from orders
      where txnid = ${key}
      for update
    `) as Array<Record<string, unknown>>;

    const order = orderRows[0];
    if (!order) {
      return { kind: 'not_found' as const };
    }
    if (input.source === 'customer' && String(order.user_id ?? '') !== input.actorId) {
      return { kind: 'not_found' as const };
    }

    const orderId = String(order.id);
    const orderTxnid = String(order.txnid);
    if (String(order.status) === 'PAID') {
      return { kind: 'already_paid' as const, orderId, txnid: orderTxnid };
    }

    // 1. Per-actor rate limit (10 requests per 60 seconds across all orders)
    const actorRows = (await tx`
      select
        count(*)::int as cnt,
        coalesce(
          ceil(extract(epoch from ((min(created_at) + make_interval(secs => ${ACTOR_VERIFY_WINDOW_SECONDS})) - coalesce(${nowIso}::timestamptz, now()))))::int,
          ${ACTOR_VERIFY_WINDOW_SECONDS}
        ) as retry_after_sec
      from payment_events
      where source = ${input.source}
        and reason = ${VERIFICATION_CLAIM_REASON}
        and payu_status = ${actorTag}
        and created_at > coalesce(${nowIso}::timestamptz, now()) - make_interval(secs => ${ACTOR_VERIFY_WINDOW_SECONDS})
        and created_at <= coalesce(${nowIso}::timestamptz, now())
    `) as Array<Record<string, unknown>>;

    const actorCount = Number(actorRows[0]?.cnt ?? 0);
    if (actorCount >= ACTOR_VERIFY_MAX_PER_WINDOW) {
      const retryAfterSec = Math.max(
        1,
        Math.min(
          ACTOR_VERIFY_WINDOW_SECONDS,
          Number(actorRows[0]?.retry_after_sec) || ACTOR_VERIFY_WINDOW_SECONDS,
        ),
      );
      return {
        kind: 'rate_limited' as const,
        retryAfterSec,
        reason: 'actor_limit' as const,
      };
    }

    // 2. Per-order 15-second cooldown and bounded 15-second active claim lease
    const recentOrderRows = (await tx`
      select
        ceil(extract(epoch from ((created_at + make_interval(secs => ${ORDER_VERIFY_COOLDOWN_SECONDS})) - coalesce(${nowIso}::timestamptz, now()))))::int as retry_after_sec
      from payment_events
      where order_id = ${orderId}
        and source = ${input.source}
        and (
          reason = ${VERIFICATION_CLAIM_REASON}
          or created_at > coalesce(${nowIso}::timestamptz, now()) - make_interval(secs => ${ORDER_VERIFY_COOLDOWN_SECONDS})
        )
        and created_at > coalesce(${nowIso}::timestamptz, now()) - make_interval(secs => ${ORDER_VERIFY_COOLDOWN_SECONDS})
        and created_at <= coalesce(${nowIso}::timestamptz, now())
      order by created_at desc, id desc
      limit 1
    `) as Array<Record<string, unknown>>;

    if (recentOrderRows.length > 0) {
      const retryAfterSec = Math.max(
        1,
        Math.min(
          ORDER_VERIFY_COOLDOWN_SECONDS,
          Number(recentOrderRows[0]?.retry_after_sec) || ORDER_VERIFY_COOLDOWN_SECONDS,
        ),
      );
      return {
        kind: 'rate_limited' as const,
        retryAfterSec,
        reason: 'order_cooldown' as const,
      };
    }

    // 3. Record the atomic claim lease before releasing the transaction lock
    await tx`
      insert into payment_events (
        order_id, txnid, source, payu_status, outcome, reason, created_at
      ) values (
        ${orderId},
        ${orderTxnid},
        ${input.source},
        ${actorTag},
        'unchanged',
        ${VERIFICATION_CLAIM_REASON},
        coalesce(${nowIso}::timestamptz, now())
      )
    `;

    return { kind: 'claimed' as const, orderId, txnid: orderTxnid };
  });
}

/** Authentication and origin are checked by the route; ownership precedes PayU. */
export async function checkCustomerPayment(
  userId: string,
  txnid: string,
  request: Request,
  deps: VerificationDependencies = dependencies,
): Promise<{ status: number; body: Record<string, unknown>; retryAfter?: number }> {
  const key = txnid.trim();
  if (!key || key.length > 100) return { status: 404, body: { error: 'Order not found.' } };

  const useCustomMocks =
    deps !== dependencies && !deps.sql;
  const sql = useCustomMocks ? null : (deps.sql ?? getSql());

  if (sql) {
    const claim = await claimPaymentVerificationInDb(sql, {
      txnid: key,
      source: 'customer',
      actorId: userId,
      now: deps.now,
    });
    if (claim.kind === 'not_found') {
      return { status: 404, body: { error: 'Order not found.' } };
    }
    if (claim.kind === 'already_paid') {
      return { status: 200, body: { ok: true, status: 'PAID', retryable: false } };
    }
    if (claim.kind === 'rate_limited') {
      return {
        status: 429,
        body: { error: 'Please wait a moment before checking this payment again.' },
        retryAfter: claim.retryAfterSec,
      };
    }
  } else {
    const order = await deps.getOrderByTxnid(key);
    if (!order || order.userId !== userId) {
      return { status: 404, body: { error: 'Order not found.' } };
    }
    // Do not contact the gateway or emit notifications again for a settled order.
    if (order.status === 'PAID') {
      return { status: 200, body: { ok: true, status: 'PAID', retryable: false } };
    }

    for (const [bucket, limit, windowMs] of [
      [`customer-payment-check:${userId}`, ACTOR_VERIFY_MAX_PER_WINDOW, ACTOR_VERIFY_WINDOW_SECONDS * 1000],
      [`customer-payment-order:${userId}:${key}`, 1, ORDER_VERIFY_COOLDOWN_SECONDS * 1000],
    ] as const) {
      const result = deps.checkRateLimit(bucket, { limit, windowMs });
      if (!result.allowed) {
        return {
          status: 429,
          body: { error: 'Please wait a moment before checking this payment again.' },
          retryAfter: result.retryAfterSec,
        };
      }
    }
  }

  const callbackOpts: CallbackOptions = {
    ...(deps.sql ? { sql: deps.sql } : {}),
    ...(deps.verifier ? { verifier: deps.verifier } : {}),
    ...(deps.sideEffects !== undefined ? { sideEffects: deps.sideEffects } : {}),
  };
  const hasCallbackOpts = Object.keys(callbackOpts).length > 0;
  const result = hasCallbackOpts
    ? await deps.verifyExistingOrderWithPayU(key, 'customer', callbackOpts)
    : await deps.verifyExistingOrderWithPayU(key, 'customer');

  await deps.writeAudit({
    action: 'payment.customer_verify',
    entity: 'order',
    entityId: key,
    status: result.rejected ? 'flagged' : result.retryable ? 'unavailable' : 'ok',
    reason: result.rejected
      ? 'verification_rejected'
      : result.retryable
        ? 'verification_unavailable'
        : 'gateway_checked',
    // Never put customer identities or gateway text in the staff audit.
    after: { orderStatus: result.status, source: 'customer' },
    request,
  });

  if (!result.order) {
    return {
      status: 503,
      body: { error: 'Payment status is temporarily unavailable. Please try again shortly.' },
    };
  }
  if (result.rejected) {
    return {
      status: 409,
      body: {
        error: 'This payment needs review. Do not pay again; contact the store.',
        status: result.status,
      },
    };
  }
  if (result.retryable) {
    return {
      status: 503,
      body: {
        error: 'We could not confirm your payment yet. Please try again shortly. Do not pay again.',
        status: result.status,
        retryable: true,
      },
    };
  }
  return { status: 200, body: { ok: true, status: result.status, retryable: false } };
}

/**
 * Store Admin "Verify with PayU" with distributed per-admin (10/min) and
 * per-order (15s lease) enforcement and already-paid short-circuiting.
 */
export async function checkAdminPayment(
  admin: { adminId: string; email: string },
  txnid: string,
  request: Request,
  deps: VerificationDependencies = dependencies,
): Promise<{ status: number; body: Record<string, unknown>; retryAfter?: number }> {
  const key = (txnid || '').trim();
  if (!key) return { status: 400, body: { error: 'Which order?' } };

  const useCustomMocks =
    deps !== dependencies && !deps.sql;
  const sql = useCustomMocks ? null : (deps.sql ?? getSql());

  if (sql) {
    const claim = await claimPaymentVerificationInDb(sql, {
      txnid: key,
      source: 'admin',
      actorId: admin.adminId,
      now: deps.now,
    });
    if (claim.kind === 'not_found') {
      return {
        status: 404,
        body: { ok: false, error: 'Order not found.', status: 'FAILED' },
      };
    }
    if (claim.kind === 'already_paid') {
      return {
        status: 200,
        body: { ok: true, txnid: claim.txnid, status: 'PAID', reason: 'Already paid.' },
      };
    }
    if (claim.kind === 'rate_limited') {
      return {
        status: 429,
        body: { error: 'Too many verification attempts. Please wait a moment.' },
        retryAfter: claim.retryAfterSec,
      };
    }
  } else {
    const limit = deps.checkRateLimit(`store-admin-verify:${admin.adminId}`, {
      limit: ACTOR_VERIFY_MAX_PER_WINDOW,
      windowMs: ACTOR_VERIFY_WINDOW_SECONDS * 1000,
    });
    if (!limit.allowed) {
      return {
        status: 429,
        body: { error: 'Too many verification attempts. Please wait a moment.' },
        retryAfter: limit.retryAfterSec,
      };
    }
  }

  const callbackOpts: CallbackOptions = {
    ...(deps.sql ? { sql: deps.sql } : {}),
    ...(deps.verifier ? { verifier: deps.verifier } : {}),
    ...(deps.sideEffects !== undefined ? { sideEffects: deps.sideEffects } : {}),
  };
  const verifyFn = deps.verifyOrderWithPayU ?? verifyOrderWithPayU;
  const hasCallbackOpts = Object.keys(callbackOpts).length > 0;
  const result = hasCallbackOpts
    ? await verifyFn(key, callbackOpts)
    : await verifyFn(key);

  await deps.writeAudit({
    actorId: admin.adminId,
    actorEmail: admin.email,
    action: 'order.payment.verify',
    entity: 'order',
    entityId: key,
    status: result.ok ? 'ok' : result.rejected ? 'flagged' : 'denied',
    reason: result.reason ?? (result.ok ? 'verified_with_payu' : 'verify_failed'),
    after: {
      orderStatus: result.status,
      outcome: result.ok ? 'settled' : 'not_settled',
    },
    request,
  });

  if (!result.ok) {
    return {
      status: result.order ? 409 : 404,
      body: {
        ok: false,
        error: result.order
          ? 'PayU did not confirm a capture for this order. It has not been marked paid.'
          : 'Order not found.',
        status: result.status,
      },
    };
  }

  return {
    status: 200,
    body: {
      ok: true,
      txnid: result.txnid,
      status: result.status,
      reason: result.reason ?? null,
    },
  };
}
