import bcrypt from 'bcryptjs';
import { getSql } from '@/lib/platform/db';
import { anonymisedEmail } from '@/lib/store-admin/customer-rules';
import { normalizeEmail } from '@/lib/coupons/rules';

export interface DataExportPayload {
  exportedAt: string;
  profile: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
    customerGroup: string;
    createdAt: string;
  };
  addresses: Array<{
    id: string;
    name: string;
    phone: string;
    line1: string;
    line2: string | null;
    city: string;
    state: string;
    pincode: string;
    isDefault: boolean;
    createdAt: string;
  }>;
  orders: Array<{
    txnid: string;
    status: string;
    amount: number;
    currency: string;
    createdAt: string;
    items: Array<{
      id: string;
      productId: string;
      name: string;
      quantity: number;
      unitPrice: number;
      totalPrice: number;
    }>;
  }>;
  requests: Array<{
    id: string;
    orderId: string;
    type: string;
    status: string;
    createdAt: string;
  }>;
  couponRedemptions: Array<{
    id: string;
    couponId: string;
    state: string;
    discountPaise: number;
    createdAt: string;
  }>;
  browsingHistory: Array<{
    productId: string;
    viewCount: number;
    lastViewedAt: string;
  }>;
}

export type ExportResult =
  | { ok: true; data: DataExportPayload }
  | { ok: false; error: string; status: number };

export type CloseAccountResult =
  | { ok: true }
  | { ok: false; error: string; status: number };

const EXPORT_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function exportCustomerData(
  userId: string,
  passwordAttempt: string,
): Promise<ExportResult> {
  const sql = getSql();
  if (!sql) return { ok: false, error: 'Database unavailable.', status: 503 };

  // 1. Verify user & password
  const userRows = await sql<Array<{
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    phone: string | null;
    customer_group: string;
    password_hash: string;
    last_data_export_at: string | Date | null;
    created_at: string | Date;
  }>>`
    select id, first_name, last_name, email, phone, customer_group,
           password_hash, last_data_export_at, created_at
    from users
    where id = ${userId}
    limit 1
  `;

  const user = userRows[0];
  if (!user) return { ok: false, error: 'Account not found.', status: 404 };

  const passwordValid = await bcrypt.compare(passwordAttempt, user.password_hash);
  if (!passwordValid) {
    return { ok: false, error: 'Incorrect password.', status: 403 };
  }

  // 2. Check 24-hour rate limit
  if (user.last_data_export_at) {
    const elapsed = Date.now() - new Date(user.last_data_export_at).getTime();
    if (elapsed < EXPORT_COOLDOWN_MS) {
      const remainingHours = Math.ceil((EXPORT_COOLDOWN_MS - elapsed) / (60 * 60 * 1000));
      return {
        ok: false,
        error: `Data export is limited to once per 24 hours. Please try again in ${remainingHours} hour(s).`,
        status: 429,
      };
    }
  }

  // 3. Gather addresses
  const addressRows = await sql<Array<{
    id: string;
    name: string;
    phone: string;
    line1: string;
    line2: string | null;
    city: string;
    state: string;
    pincode: string;
    is_default: boolean;
    created_at: string | Date;
  }>>`
    select id, name, phone, line1, line2, city, state, pincode, is_default, created_at
    from customer_addresses
    where user_id = ${userId}
    order by created_at desc
  `;

  // 4. Gather orders and items
  const orderRows = await sql<Array<{
    id: string;
    txnid: string;
    status: string;
    amount: string | number;
    currency: string;
    created_at: string | Date;
  }>>`
    select id, txnid, status, amount, currency, created_at
    from orders
    where user_id = ${userId}
    order by created_at desc
  `;

  const orderIds = orderRows.map((o) => o.id);
  let itemRows: Array<{
    id: string;
    order_id: string;
    product_id: string;
    name: string;
    quantity: number;
    unit_price: string | number;
    total_price: string | number;
  }> = [];

  if (orderIds.length > 0) {
    itemRows = await sql`
      select id, order_id, product_id, name, quantity, unit_price, total_price
      from order_items
      where order_id = any(${orderIds}::text[])
    `;
  }

  const itemsByOrder = new Map<string, typeof itemRows>();
  for (const it of itemRows) {
    const arr = itemsByOrder.get(it.order_id) || [];
    arr.push(it);
    itemsByOrder.set(it.order_id, arr);
  }

  // 5. Gather requests
  const requestRows = await sql<Array<{
    id: string;
    order_id: string;
    type: string;
    status: string;
    created_at: string | Date;
  }>>`
    select r.id, r.order_id, r.type, r.status, r.created_at
    from order_requests r
    join orders o on o.txnid = r.order_id or o.id = r.order_id
    where o.user_id = ${userId}
    order by r.created_at desc
  `;

  // 6. Gather coupon redemptions
  const redemptionRows = await sql<Array<{
    id: string;
    coupon_id: string;
    state: string;
    discount_paise: number;
    created_at: string | Date;
  }>>`
    select id, coupon_id, state, discount_paise, created_at
    from coupon_redemptions
    where customer_user_id = ${userId}
    order by created_at desc
  `;

  // 7. Gather browsing history
  const historyRows = await sql<Array<{
    product_id: string;
    view_count: number;
    last_viewed_at: string | Date;
  }>>`
    select product_id, view_count, last_viewed_at
    from customer_browsing_history
    where user_id = ${userId}
    order by last_viewed_at desc
  `;

  // 8. Update last_data_export_at timestamp
  await sql`
    update users
    set last_data_export_at = now()
    where id = ${userId}
  `;

  const payload: DataExportPayload = {
    exportedAt: new Date().toISOString(),
    profile: {
      id: user.id,
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
      phone: user.phone,
      customerGroup: user.customer_group,
      createdAt: new Date(user.created_at).toISOString(),
    },
    addresses: addressRows.map((a) => ({
      id: a.id,
      name: a.name,
      phone: a.phone,
      line1: a.line1,
      line2: a.line2,
      city: a.city,
      state: a.state,
      pincode: a.pincode,
      isDefault: a.is_default,
      createdAt: new Date(a.created_at).toISOString(),
    })),
    orders: orderRows.map((o) => ({
      txnid: o.txnid,
      status: o.status,
      amount: Number(o.amount) || 0,
      currency: o.currency,
      createdAt: new Date(o.created_at).toISOString(),
      items: (itemsByOrder.get(o.id) || []).map((i) => ({
        id: i.id,
        productId: i.product_id,
        name: i.name,
        quantity: i.quantity,
        unitPrice: Number(i.unit_price) || 0,
        totalPrice: Number(i.total_price) || 0,
      })),
    })),
    requests: requestRows.map((r) => ({
      id: r.id,
      orderId: r.order_id,
      type: r.type,
      status: r.status,
      createdAt: new Date(r.created_at).toISOString(),
    })),
    couponRedemptions: redemptionRows.map((cr) => ({
      id: cr.id,
      couponId: cr.coupon_id,
      state: cr.state,
      discountPaise: cr.discount_paise,
      createdAt: new Date(cr.created_at).toISOString(),
    })),
    browsingHistory: historyRows.map((h) => ({
      productId: h.product_id,
      viewCount: h.view_count,
      lastViewedAt: new Date(h.last_viewed_at).toISOString(),
    })),
  };

  return { ok: true, data: payload };
}

export async function closeCustomerAccount(
  userId: string,
  emailAttempt: string,
  passwordAttempt: string,
): Promise<CloseAccountResult> {
  const sql = getSql();
  if (!sql) return { ok: false, error: 'Database unavailable.', status: 503 };

  // 1. Verify user & credentials
  const userRows = await sql<Array<{
    id: string;
    email: string;
    password_hash: string;
    anonymised_at: string | Date | null;
  }>>`
    select id, email, password_hash, anonymised_at
    from users
    where id = ${userId}
    limit 1
  `;

  const user = userRows[0];
  if (!user || user.anonymised_at) {
    return { ok: false, error: 'Account not found or already closed.', status: 404 };
  }

  if (normalizeEmail(user.email) !== normalizeEmail(emailAttempt)) {
    return { ok: false, error: 'The email address you entered does not match your account.', status: 400 };
  }

  const passwordValid = await bcrypt.compare(passwordAttempt, user.password_hash);
  if (!passwordValid) {
    return { ok: false, error: 'Incorrect password.', status: 403 };
  }

  // 2. Check for unpaid or in-flight orders
  const openOrderRows = await sql<Array<{
    txnid: string;
    status: string;
    fulfilment_status: string | null;
  }>>`
    select o.txnid, o.status,
           coalesce(d.status, o.fulfilment_status, 'PENDING') as fulfilment_status
    from orders o
    left join order_deliveries d on d.order_id = o.id
    where o.user_id = ${userId}
      and o.status not in ('CANCELLED', 'REFUNDED', 'FAILED')
  `;

  for (const ord of openOrderRows) {
    if (ord.status !== 'PAID') {
      return {
        ok: false,
        error: `Account closure refused: Order ${ord.txnid} is still pending payment.`,
        status: 400,
      };
    }
    const fs = ord.fulfilment_status?.toUpperCase();
    if (fs !== 'DELIVERED' && fs !== 'CANCELLED' && fs !== 'FAILED') {
      return {
        ok: false,
        error: `Account closure refused: Order ${ord.txnid} is currently in transit or being processed.`,
        status: 400,
      };
    }
  }

  // 3. Check for open requests
  const openRequestRows = await sql<Array<{ id: string; order_id: string }>>`
    select r.id, r.order_id
    from order_requests r
    join orders o on o.txnid = r.order_id or o.id = r.order_id
    where o.user_id = ${userId}
      and r.status in ('OPEN', 'IN_PROGRESS')
    limit 1
  `;
  if (openRequestRows.length > 0) {
    return {
      ok: false,
      error: 'Account closure refused: You have an open order request or return that is not yet resolved.',
      status: 400,
    };
  }

  // 4. Anonymise customer account & revoke sessions
  const previousEmail = normalizeEmail(user.email);
  const anonEmail = anonymisedEmail(userId);

  try {
    await sql.begin(async (tx) => {
      // Revoke all customer sessions
      await tx`delete from user_sessions where user_id = ${userId}`;
      // Remove addresses
      await tx`delete from customer_addresses where user_id = ${userId}`;
      // Remove browsing history
      await tx`delete from customer_browsing_history where user_id = ${userId}`;
      // Unsubscribe newsletter
      if (previousEmail) {
        await tx`
          update newsletter_subscribers
          set unsubscribed_at = now(),
              unsubscribe_reason = 'Account closed by customer',
              updated_at = now()
          where email = ${previousEmail} and unsubscribed_at is null
        `;
      }
      // Overwrite personal fields and free email
      await tx`
        update users
        set email = ${anonEmail},
            first_name = '',
            last_name = '',
            phone = null,
            is_blocked = true,
            blocked_at = now(),
            blocked_reason = 'Account closed by customer',
            anonymised_at = now(),
            customer_group = 'retail',
            marketing_opt_in = false,
            updated_at = now()
        where id = ${userId}
      `;
    });

    return { ok: true };
  } catch (err) {
    console.error('[closeCustomerAccount] error:', err);
    return { ok: false, error: 'Could not close account. Please try again.', status: 500 };
  }
}

