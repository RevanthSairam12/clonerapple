import { randomBytes } from 'node:crypto';
import { createFixtureSchema, dropFixtureSchema } from './isolated-schema.mjs';

/** Tables read or written by the web checkout's authoritative transaction. */
export const SHIPPING_CHECKOUT_TABLES = [
  'categories',
  'products',
  // Checkout parses these Phase 4 joins even for a parent-only product.
  'product_variants',
  'device_models',
  'device_brands',
  'product_types',
  'product_device_models',
  'product_images',
  'stock',
  'stock_movements',
  'sale_settings',
  'store_settings',
  'orders',
  'order_items',
  'order_addresses',
  'order_status_history',
  'coupons',
  'coupon_targets',
  'coupon_redemptions',
];

export function token(prefix = 'ship') {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(5).toString('hex')}`;
}

export function txnid() {
  return `SHP${randomBytes(8).toString('hex').toUpperCase()}`;
}

/**
 * Clone empty checkout tables with the shared owned lifecycle, RLS and serial
 * isolation. Sequence names are implementation details: the shared helper
 * discovers every copied serial default rather than maintaining six names.
 * Generated ids still start locally and increase across fixture inserts.
 */
export async function createShippingFixtureSchema(sql, schema) {
  await createFixtureSchema(sql, schema, SHIPPING_CHECKOUT_TABLES);
}

export async function dropShippingFixtureSchema(sql, schema) {
  await dropFixtureSchema(sql, schema);
}

/** Seed one active product and its tracked stock row. */
export async function seedProduct(sql, {
  id = token('product'),
  pricePaise,
  salePricePaise = null,
  stock = 20,
} = {}) {
  const categoryId = token('category');
  await sql`
    insert into categories (id, slug, name)
    values (${categoryId}, ${categoryId}, 'Shipping test category')
  `;
  await sql`
    insert into products (
      id, category_id, slug, name, price_paise, sale_price_paise,
      currency, in_stock, is_active
    ) values (
      ${id}, ${categoryId}, ${id}, 'Shipping test product', ${pricePaise},
      ${salePricePaise}, 'INR', true, true
    )
  `;
  await sql`
    insert into product_images (id, product_id, url, role)
    values (${token('image')}, ${id}, '/shipping-test.png', 'primary')
  `;
  await sql`
    insert into stock (id, product_id, variant_id, on_hand, reserved, track_inventory)
    values (${token('stock')}, ${id}, null, ${stock}, 0, true)
  `;
  return { id, categoryId };
}

/** Canonical shipping plus the switches required by web checkout. */
export async function seedCheckoutConfiguration(sql, {
  chargePaise = 5000,
  thresholdPaise = 99900,
  shippingEnabled = 'on',
  saleEnabled = false,
} = {}) {
  await sql`
    insert into store_settings (key, value) values
      ('shipping_charge_paise', ${String(chargePaise)}),
      ('free_shipping_threshold_paise', ${String(thresholdPaise)}),
      ('shipping_enabled', ${shippingEnabled}),
      ('payu_enabled', 'on'),
      ('coupons_enabled', 'on')
    on conflict (key) do update set value = excluded.value
  `;
  await sql`
    insert into sale_settings (id, enabled, starts_at, ends_at)
    values ('default', ${saleEnabled}, now() - interval '1 hour', now() + interval '1 hour')
    on conflict (id) do update set
      enabled = excluded.enabled,
      starts_at = excluded.starts_at,
      ends_at = excluded.ends_at
  `;
}

export async function seedCoupon(sql, {
  id = token('coupon'),
  code = `SAVE${randomBytes(3).toString('hex').toUpperCase()}`,
  type = 'PERCENT',
  value = 10,
  allowWithSalePrice = false,
} = {}) {
  await sql`
    insert into coupons (
      id, code, name, type, value, scope, status, allow_with_sale_price
    ) values (
      ${id}, ${code}, 'Shipping test coupon', ${type}, ${value},
      'ORDER', 'active', ${allowWithSalePrice}
    )
  `;
  return { id, code, type, value };
}

export function checkoutParams({ productId, unitPaise, expectedTotalPaise, couponCode, quantity = 1 }) {
  return {
    txnid: txnid(),
    cartItems: [{ id: productId, quantity, expectedUnitPaise: unitPaise }],
    expectedTotalPaise,
    currency: 'INR',
    paymentMethod: 'payu',
    customerName: 'Shipping Test Buyer',
    customerEmail: `shipping-${randomBytes(4).toString('hex')}@example.test`,
    customerPhone: '9000000000',
    shippingAddress: {
      name: 'Shipping Test Buyer', phone: '9000000000', line1: '1 Test Lane',
      line2: '', city: 'Bengaluru', state: 'Karnataka', pincode: '560001',
    },
    reservationSeconds: 0,
    ...(couponCode ? { coupon: { code: couponCode } } : {}),
  };
}
