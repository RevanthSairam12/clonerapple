import { getSql } from '@/lib/admin/db';
import { maskAccountEmail } from '@/lib/account/rules';
import {
  toAccountOrderStatus,
  type AccountOrderStatus,
} from '@/lib/account/order-live';
import { getCustomerCouponCount } from '@/lib/account/coupons';
import { getStoreSettings } from '@/lib/store-admin/settings';

export interface AccountDashboardSummary {
  user: {
    firstName: string;
    lastName: string;
    email: string;
    emailMasked: string;
    phone: string | null;
    phoneMasked: string | null;
    hasPhone: boolean;
  };
  orders: {
    totalCount: number;
    inTransitCount: number;
    latestOrder: {
      txnid: string;
      orderNumber: string;
      status: AccountOrderStatus;
      amountPaise: number;
      createdAt: string;
      createdAtDisplay: string;
    } | null;
  };
  requests: {
    openCount: number;
    latestRequest: {
      type: string;
      status: string;
      createdAt: string;
    } | null;
  };
  addresses: {
    totalCount: number;
    defaultAddressMasked: string | null;
  };
  security: {
    lastLoginAt: string | null;
    lastLoginDisplay: string;
    activeSessionsCount: number;
    passwordChangePrompt: boolean;
  };
  coupons: {
    availableCount: number;
  };
  messages: {
    unreadCount: number;
  };
  support: {
    phone: string;
    email: string;
  };
}

function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length < 4) return '***';
  return `${cleaned.slice(0, 2)}******${cleaned.slice(-2)}`;
}

function maskAddress(line1: string, city: string, pincode: string): string {
  const shortLine = line1.length > 8 ? `${line1.slice(0, 6)}...` : line1;
  return `${shortLine}, ${city} ${pincode}`;
}

export async function getAccountDashboardSummary(
  userId: string,
): Promise<AccountDashboardSummary | null> {
  const sql = getSql();
  if (!sql) return null;

  // Batched queries in 2 minimal parallel roundtrips
  const [userQuery, aggregatesQuery, couponCount, storeSettingsRes] = await Promise.all([
    // 1. User details & active sessions
    sql<Array<{
      first_name: string;
      last_name: string;
      email: string;
      phone: string | null;
      last_login_at: string | Date | null;
      password_changed_at: string | Date | null;
      created_at: string | Date;
      active_sessions: number;
    }>>`
      select
        u.first_name, u.last_name, u.email, u.phone,
        u.last_login_at, u.password_changed_at, u.created_at,
        (
          select count(*)::int
          from user_sessions s
          where s.user_id = u.id and s.expires_at > now()
        ) as active_sessions
      from users u
      where u.id = ${userId}
      limit 1
    `,

    // 2. Orders, requests, addresses, messages
    sql<Array<{
      total_orders: number;
      in_transit_orders: number;
      latest_txnid: string | null;
      latest_order_number: string | null;
      latest_order_status: string | null;
      latest_order_amount: string | number | null;
      latest_order_created_at: string | Date | null;
      open_requests: number;
      latest_request_type: string | null;
      latest_request_status: string | null;
      latest_request_created_at: string | Date | null;
      total_addresses: number;
      default_address_line1: string | null;
      default_address_city: string | null;
      default_address_pincode: string | null;
      unread_messages: number;
    }>>`
      select
        -- Orders count
        (select count(*)::int from orders where user_id = ${userId}) as total_orders,
        -- In transit count
        (
          select count(*)::int
          from orders o
          left join order_deliveries d on d.order_id = o.id
          where o.user_id = ${userId}
            and (
              coalesce(d.status, o.fulfilment_status, '') in ('PROCESSING', 'SCHEDULED', 'ON_THE_WAY', 'OUT_FOR_DELIVERY')
              or (o.status = 'PAID' and coalesce(d.status, o.fulfilment_status, '') not in ('DELIVERED', 'CANCELLED', 'FAILED'))
            )
        ) as in_transit_orders,
        -- Latest order fields
        lat_ord.txnid as latest_txnid,
        lat_ord.order_number as latest_order_number,
        coalesce(lat_ord.fulfilment_status, lat_ord.status) as latest_order_status,
        lat_ord.amount as latest_order_amount,
        lat_ord.created_at as latest_order_created_at,
        -- Open requests count
        (
          select count(*)::int
          from order_requests r
          join orders o on o.txnid = r.order_id or o.id = r.order_id
          where o.user_id = ${userId} and r.status in ('OPEN', 'IN_PROGRESS')
        ) as open_requests,
        -- Latest request fields
        lat_req.type as latest_request_type,
        lat_req.status as latest_request_status,
        lat_req.created_at as latest_request_created_at,
        -- Addresses count & default address
        (
          select count(*)::int
          from customer_addresses
          where user_id = ${userId} and deleted_at is null
        ) as total_addresses,
        def_addr.line1 as default_address_line1,
        def_addr.city as default_address_city,
        def_addr.pincode as default_address_pincode,
        -- Unread messages
        (
          select count(*)::int
          from notification_outbox
          where customer_user_id = ${userId} and read_at is null
        ) as unread_messages
      from (select 1) as dummy
      left join lateral (
        select o.txnid, o.order_number, o.status, o.amount, o.created_at,
               coalesce(d.status, o.fulfilment_status, 'PENDING') as fulfilment_status
        from orders o
        left join order_deliveries d on d.order_id = o.id
                where o.user_id = ${userId}
        order by o.created_at desc
        limit 1
      ) as lat_ord on true
      left join lateral (
        select r.type, r.status, r.created_at
        from order_requests r
        join orders o on o.txnid = r.order_id or o.id = r.order_id
        where o.user_id = ${userId}
        order by r.created_at desc
        limit 1
      ) as lat_req on true
      left join lateral (
        select line1, city, pincode
        from customer_addresses
        where user_id = ${userId} and deleted_at is null and is_default = true
        limit 1
      ) as def_addr on true
    `,

    // 3. Available private coupons count
    getCustomerCouponCount(userId),

    // 4. Store contact info
    getStoreSettings(),
  ]);

  const user = userQuery[0];
  if (!user) return null;

  const agg = aggregatesQuery[0];
  const settings = storeSettingsRes.ok ? storeSettingsRes.settings : null;

  // Password change prompt check: if password has not been changed in > 90 days or never set
  const passwordChangedAt = user.password_changed_at ? new Date(user.password_changed_at) : null;
  const createdAt = new Date(user.created_at);
  const checkDate = passwordChangedAt || createdAt;
  const daysSincePassword = Math.floor((Date.now() - checkDate.getTime()) / (1000 * 60 * 60 * 24));
  const passwordChangePrompt = daysSincePassword > 90;

  // Last login display
  let lastLoginDisplay = 'First sign-in';
  if (user.last_login_at) {
    const l = new Date(user.last_login_at);
    lastLoginDisplay = l.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  // Latest order
  let latestOrder = null;
  if (agg?.latest_txnid) {
    const d = new Date(agg.latest_order_created_at || 0);
    latestOrder = {
      txnid: agg.latest_txnid,
      orderNumber: agg.latest_order_number ? String(agg.latest_order_number) : agg.latest_txnid,
      status: toAccountOrderStatus(agg.latest_order_status),
      amountPaise: Math.round(Number(agg.latest_order_amount || 0) * 100),
      createdAt: d.toISOString(),
      createdAtDisplay: d.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }),
    };
  }

  // Latest request
  let latestRequest = null;
  if (agg?.latest_request_type) {
    latestRequest = {
      type: agg.latest_request_type,
      status: agg.latest_request_status || 'OPEN',
      createdAt: new Date(agg.latest_request_created_at || 0).toISOString(),
    };
  }

  // Default address masked
  let defaultAddressMasked: string | null = null;
  if (agg?.default_address_line1 && agg?.default_address_city && agg?.default_address_pincode) {
    defaultAddressMasked = maskAddress(
      agg.default_address_line1,
      agg.default_address_city,
      agg.default_address_pincode,
    );
  }

  return {
    user: {
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
      emailMasked: maskAccountEmail(user.email),
      phone: user.phone,
      phoneMasked: maskPhone(user.phone),
      hasPhone: Boolean(user.phone && user.phone.trim()),
    },
    orders: {
      totalCount: agg?.total_orders ?? 0,
      inTransitCount: agg?.in_transit_orders ?? 0,
      latestOrder,
    },
    requests: {
      openCount: agg?.open_requests ?? 0,
      latestRequest,
    },
    addresses: {
      totalCount: agg?.total_addresses ?? 0,
      defaultAddressMasked,
    },
    security: {
      lastLoginAt: user.last_login_at ? new Date(user.last_login_at).toISOString() : null,
      lastLoginDisplay,
      activeSessionsCount: user.active_sessions || 1,
      passwordChangePrompt,
    },
    coupons: {
      availableCount: couponCount,
    },
    messages: {
      unreadCount: agg?.unread_messages ?? 0,
    },
    support: {
      phone: settings?.phone || '+91 80000 12345',
      email: settings?.email || 'support@gadzio.in',
    },
  };
}

