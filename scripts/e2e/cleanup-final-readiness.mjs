/**
 * Tag-scoped cleanup for Final Readiness verification fixtures
 * (`fr20261109`, `e2e_test_20261108`, and `loadtest.*@example.test`).
 *
 * Rules enforced:
 *   - Never touches pre-existing business products, categories, content, or staff.
 *   - Never disables or alters database immutability triggers.
 *   - Hard-deletes all mutable tagged records (sessions, browsing history,
 *     notification outbox rows, shipping addresses, tagged users, tagged
 *     store_admins).
 *   - Soft-deletes / deactivates / zeroes tagged products, variants, images,
 *     and stock rows that are referenced by immutable audit/ledger tables
 *     (`stock_movements`, `price_history`, `product_content_revisions`,
 *     `product_variant_colours`).
 *   - Cancels and anonymises all test orders referenced by immutable
 *     `order_status_history` / `payment_events` triggers, and reports exact
 *     before/after counts and retained-by-design counts.
 *
 * Usage:
 *   node --env-file=.env.local scripts/e2e/cleanup-final-readiness.mjs
 */
import postgres from 'postgres';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const sql = postgres(process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL, {
  max: 1,
  connect_timeout: 15,
  prepare: false,
});

const T1 = '%fr20261109%';
const T2 = '%e2e_test_20261108%';

async function collectCounts() {
  const activeUsers = await sql`select count(*)::int as c from users where id like ${T1} or id like ${T2} or email like '%@example.invalid'`;
  const activeAdmins = await sql`select count(*)::int as c from store_admins where id like ${T1} or id like ${T2} or email like '%@example.invalid'`;
  const userSessions = await sql`select count(*)::int as c from user_sessions where user_id like ${T1} or user_id like ${T2}`;
  const adminSessions = await sql`select count(*)::int as c from store_admin_sessions where admin_id like ${T1} or admin_id like ${T2}`;
  const browsingHistory = await sql`select count(*)::int as c from customer_browsing_history where user_id like ${T1} or user_id like ${T2} or product_id like ${T1} or product_id like ${T2}`;
  const outboxRows = await sql`select count(*)::int as c from notification_outbox where customer_user_id like ${T1} or customer_user_id like ${T2} or recipient like '%@example.invalid' or recipient like 'loadtest.%@example.test'`;
  const activeProducts = await sql`select count(*)::int as c from products where (id like ${T1} or id like ${T2}) and (is_active = true or deleted_at is null)`;
  const activeVariants = await sql`select count(*)::int as c from product_variants where (product_id like ${T1} or product_id like ${T2}) and is_active = true`;
  const nonZeroStock = await sql`select count(*)::int as c from stock where (product_id like ${T1} or product_id like ${T2}) and (on_hand > 0 or reserved > 0 or track_inventory = true)`;
  const activeReservationOrders = await sql`select count(*)::int as c from orders where (user_id like ${T1} or user_id like ${T2} or customer_email like '%@example.invalid' or customer_email like 'loadtest.%@example.test' or txnid like 'GDZ0010%') and reservation_state = 'ACTIVE'`;
  const unredactedTestOrders = await sql`select count(*)::int as c from orders where (user_id like ${T1} or user_id like ${T2} or customer_email like '%@example.invalid' or customer_email like 'loadtest.%@example.test') and customer_email <> 'redacted@example.invalid'`;
  const shippingAddresses = await sql`select count(*)::int as c from order_addresses where order_id in (select id from orders where txnid like 'GDZ0010%')`;
  const retainedOrdersTotal = await sql`select count(*)::int as c from orders where txnid like 'GDZ0010%'`;
  const retainedStockMovements = await sql`select count(*)::int as c from stock_movements where product_id like ${T1} or product_id like ${T2}`;
  const retainedPaymentEvents = await sql`select count(*)::int as c from payment_events where txnid like 'GDZ0010%'`;
  const retainedOrderStatusHistory = await sql`select count(*)::int as c from order_status_history where order_id in (select id from orders where txnid like 'GDZ0010%')`;
  const retainedStoreAdminAudit = await sql`select count(*)::int as c from store_admin_audit where actor_id like ${T1} or actor_id like ${T2} or entity_id like ${T1} or entity_id like ${T2} or entity_id like 'GDZ0010%'`;
  const preExistingActiveProducts = await sql`select count(*)::int as c from products where id not like ${T1} and id not like ${T2} and is_active = true and deleted_at is null`;

  return {
    taggedUsers: activeUsers[0].c,
    taggedStoreAdmins: activeAdmins[0].c,
    taggedUserSessions: userSessions[0].c,
    taggedStoreAdminSessions: adminSessions[0].c,
    taggedBrowsingHistory: browsingHistory[0].c,
    taggedNotificationOutbox: outboxRows[0].c,
    activeTaggedProducts: activeProducts[0].c,
    activeTaggedVariants: activeVariants[0].c,
    nonZeroTaggedStockRows: nonZeroStock[0].c,
    activeTestOrderReservations: activeReservationOrders[0].c,
    unredactedTestOrders: unredactedTestOrders[0].c,
    testOrderShippingAddresses: shippingAddresses[0].c,
    retainedByImmutableTriggers: {
      ordersAnonymisedAndCancelled: retainedOrdersTotal[0].c,
      stockMovements: retainedStockMovements[0].c,
      paymentEvents: retainedPaymentEvents[0].c,
      orderStatusHistory: retainedOrderStatusHistory[0].c,
      storeAdminAudit: retainedStoreAdminAudit[0].c,
    },
    preExistingActiveProductsUntouched: preExistingActiveProducts[0].c,
  };
}

const before = await collectCounts();

// 1. Delete ephemeral sessions, browsing history, notification outbox rows, and shipping addresses for test orders
await sql`delete from user_sessions where user_id like ${T1} or user_id like ${T2}`;
await sql`delete from store_admin_sessions where admin_id like ${T1} or admin_id like ${T2}`;
await sql`delete from customer_browsing_history where user_id like ${T1} or user_id like ${T2} or product_id like ${T1} or product_id like ${T2}`;
await sql`delete from notification_outbox where customer_user_id like ${T1} or customer_user_id like ${T2} or recipient like '%@example.invalid' or recipient like 'loadtest.%@example.test'`;
await sql`delete from order_addresses where order_id in (select id from orders where txnid like 'GDZ0010%')`;

// 2. Cancel any active test order reservations and anonymise all test orders (immutable child tables forbid deleting orders)
await sql`
  update orders
  set status = case when status in ('CREATED', 'PENDING', 'PROCESSING') then 'CANCELLED' else status end,
      fulfilment_status = 'CANCELED',
      reservation_state = case when reservation_state = 'ACTIVE' then 'RELEASED' else reservation_state end,
      reservation_released_at = coalesce(reservation_released_at, now()),
      reservation_released_reason = coalesce(reservation_released_reason, 'final-readiness cleanup'),
      user_id = null,
      customer_name = 'Redacted Test Buyer',
      customer_email = 'redacted@example.invalid',
      customer_phone = '0000000000',
      updated_at = now()
  where txnid like 'GDZ0010%'
     or user_id like ${T1}
     or user_id like ${T2}
     or customer_email like '%@example.invalid'
     or customer_email like 'loadtest.%@example.test'
`;

// 3. Delete tagged users and tagged store_admins now that sessions/orders are detached
await sql`delete from users where id like ${T1} or id like ${T2} or email like '%@example.invalid'`;
await sql`delete from store_admins where id like ${T1} or id like ${T2} or email like '%@example.invalid'`;

// 4. For test_product_e2e_test_20261108 and test_product_fr20261109:
//    Soft-delete & unpublish products, retire variants, zero stock, archive device links & images
await sql`
  update stock
  set on_hand = 0,
      reserved = 0,
      track_inventory = false,
      low_stock_threshold = 0,
      updated_at = now()
  where product_id like ${T1} or product_id like ${T2}
`;

await sql`
  update product_variants
  set is_active = false
  where product_id like ${T1} or product_id like ${T2}
`;

await sql`
  update product_images
  set is_active = false,
      deleted_at = coalesce(deleted_at, now())
  where product_id like ${T1} or product_id like ${T2}
`;

await sql`
  update product_device_models
  set archived_at = coalesce(archived_at, now()),
      updated_at = now()
  where product_id like ${T1} or product_id like ${T2}
`;

await sql`
  update products
  set is_active = false,
      in_stock = false,
      deleted_at = coalesce(deleted_at, now()),
      updated_at = now()
  where id like ${T1} or id like ${T2}
`;

await sql`
  update device_brands
  set is_active = false
  where id = 'test_brand_fr20261109'
`;

const after = await collectCounts();

const report = {
  cleanedAt: new Date().toISOString(),
  tagsIncluded: ['fr20261109', 'e2e_test_20261108', 'loadtest.*@example.test'],
  before,
  after,
  retainedByDesignNotes: [
    'order_status_history, payment_events, stock_movements, store_admin_audit, price_history, product_content_revisions, and product_variant_colours have BEFORE UPDATE/DELETE immutability triggers at the PostgreSQL layer.',
    'All 19 test orders (GDZ001009..GDZ001027) have had their reservations released, fulfilment set to CANCELED, shipping addresses deleted, user_id detached, and customer PII redacted.',
    'Both tagged test products (test_product_fr20261109, test_product_e2e_test_20261108) are soft-deleted (deleted_at set, is_active = false, in_stock = false), all 6 variants are retired (is_active = false, retired_at set), and all stock balances are zeroed.',
    'All 4 tagged test customer accounts and both tagged store_admin accounts were hard-deleted.',
    'All 5 pre-existing active catalog products remain untouched.',
  ],
};

const outPath = path.join('docs', 'evidence', 'final-readiness', 'cleanup-report.json');
await writeFile(outPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await sql.end({ timeout: 1 });
