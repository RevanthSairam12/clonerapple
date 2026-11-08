import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createJiti } from 'jiti';
import postgres from 'postgres';
import { createFixtureSchema, dropFixtureSchema } from './helpers/isolated-schema.mjs';

const root = process.cwd();

if (process.env.RUN_LEGACY_DB_TESTS === '1' && !process.env.DATABASE_URL) {
  try {
    const env = await readFile(path.join(root, '.env.local'), 'utf8');
    for (const line of env.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
      }
    }
  } catch {
    // ignore
  }
}

const connUrl = (process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL || '').trim();
const skip =
  process.env.RUN_LEGACY_DB_TESTS !== '1'
    ? 'legacy database tests require explicit RUN_LEGACY_DB_TESTS=1 approval'
    : !connUrl
      ? 'DATABASE_URL not set'
      : new URL(connUrl).port === '6543'
        ? 'requires session connection on port 5432'
        : false;

const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { '@': path.join(root, 'src') },
});

const { planOrderLowStockAlerts } = await jiti.import(
  path.join(root, 'src/lib/notifications/stock-events.ts'),
);
const { enqueueOrderLowStockAlerts } = await jiti.import(
  path.join(root, 'src/lib/notifications/order-stock-alerts.ts'),
);
const { createOrderUsing } = await jiti.import(path.join(root, 'src/lib/payu/orders.ts'));
const { createPosSaleUsing, openShift } = await jiti.import(
  path.join(root, 'src/lib/store-admin/pos.ts'),
);

test('planOrderLowStockAlerts emits one alert per option crossing and ignores already-low, zero or untracked rows', () => {
  const alerts = planOrderLowStockAlerts([
    {
      movementId: 101,
      productId: 'case-16',
      variantId: 'var-red',
      productName: 'Gadzio Back Case',
      optionLabel: 'iPhone 16 · Red',
      availableBefore: 4,
      availableAfter: 3,
      lowStockThreshold: 3,
      trackInventory: true,
    },
    // Duplicate identity in same batch is deduplicated
    {
      movementId: 102,
      productId: 'case-16',
      variantId: 'var-red',
      productName: 'Gadzio Back Case',
      optionLabel: 'iPhone 16 · Red',
      availableBefore: 4,
      availableAfter: 2,
      lowStockThreshold: 3,
      trackInventory: true,
    },
    // Already low (3 -> 2 with threshold 3) does not alert
    {
      movementId: 103,
      productId: 'case-16',
      variantId: 'var-blue',
      productName: 'Gadzio Back Case',
      optionLabel: 'iPhone 16 · Blue',
      availableBefore: 3,
      availableAfter: 2,
      lowStockThreshold: 3,
      trackInventory: true,
    },
    // Dropping to 0 is out of stock, not low stock
    {
      movementId: 104,
      productId: 'case-16',
      variantId: 'var-green',
      productName: 'Gadzio Back Case',
      optionLabel: 'iPhone 16 · Green',
      availableBefore: 2,
      availableAfter: 0,
      lowStockThreshold: 3,
      trackInventory: true,
    },
    // Untracked option never alerts
    {
      movementId: 105,
      productId: 'case-16',
      variantId: 'var-clear',
      productName: 'Gadzio Back Case',
      optionLabel: 'iPhone 16 · Clear',
      availableBefore: 5,
      availableAfter: 1,
      lowStockThreshold: 3,
      trackInventory: false,
    },
  ]);

  assert.deepEqual(alerts, [
    {
      event: 'low_stock',
      productId: 'case-16',
      variantId: 'var-red',
      productName: 'Gadzio Back Case — iPhone 16 · Red',
      stockAvailable: 3,
      staffLink: '/store-admin/stock/case-16?variant=var-red',
      token: 'movement:101',
    },
  ]);
});

const TABLES = [
  'categories',
  'product_types',
  'device_brands',
  'device_models',
  'products',
  'product_variants',
  'product_device_models',
  'colours',
  'product_variant_colours',
  'stock',
  'stock_movements',
  'orders',
  'order_items',
  'order_addresses',
  'order_status_history',
  'order_payments',
  'pos_shifts',
  'receipt_counters',
  'invoice_number_counters',
  'store_admins',
  'store_admin_audit',
  'store_settings',
  'email_templates',
  'automated_messages',
  'notification_channel_settings',
  'notification_outbox',
];

test(
  'DB integration: checkout and POS sales enqueue per-option low-stock staff notifications after commit and dedupe per crossing',
  { skip },
  async () => {
    const tag = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
    const schema = `itest_lowstk_${tag}`;
    const sql = postgres(connUrl, {
      max: 1,
      prepare: false,
      ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require',
      connection: { search_path: 'pg_catalog' },
      onnotice: () => {},
    });

    try {
      await createFixtureSchema(sql, schema, TABLES);

      const catId = `cat_${tag}`;
      const brandId = `br_${tag}`;
      const modelId = `dm_${tag}`;
      const prodId = `prod_${tag}`;
      const redVarId = `vred_${tag}`;
      const blkVarId = `vblk_${tag}`;
      const staffId = `stf_${tag}`;

      await sql`insert into categories (id, slug, name) values (${catId}, ${catId}, 'Cases')`;
      await sql`insert into device_brands (id, name) values (${brandId}, 'Apple')`;
      await sql`insert into device_models (id, brand_id, name) values (${modelId}, ${brandId}, 'iPhone 16')`;
      await sql`
        insert into products (id, category_id, slug, name, price_paise, inventory_mode, is_active)
        values (${prodId}, ${catId}, ${prodId}, 'Gadzio Armor Case', 10000, 'variant', true)
      `;
      await sql`
        insert into product_variants (
          id, product_id, sku, option_name, option_value, is_purchasable, is_active,
          device_model_id, combination_key
        ) values
          (${redVarId}, ${prodId}, ${`SKU-RED-${tag}`}, 'Colour', 'Red', true, true, ${modelId}, ${redVarId}),
          (${blkVarId}, ${prodId}, ${`SKU-BLK-${tag}`}, 'Colour', 'Black', true, true, ${modelId}, ${blkVarId})
      `;
      await sql`
        insert into product_device_models (product_id, device_model_id)
        values (${prodId}, ${modelId})
      `;
      await sql`
        insert into stock (id, product_id, variant_id, on_hand, reserved, track_inventory, low_stock_threshold)
        values
          (${`stk_red_${tag}`}, ${prodId}, ${redVarId}, 4, 0, true, 3),
          (${`stk_blk_${tag}`}, ${prodId}, ${blkVarId}, 5, 0, true, 2)
      `;
      await sql`
        insert into store_admins (id, email, password_hash, name, role, is_active)
        values (${staffId}, ${`owner_${tag}@example.invalid`}, 'fixture-hash', 'Owner', 'store_owner', true)
      `;
      await sql`
        insert into receipt_counters (name, next_number)
        values ('pos_receipt', 1)
        on conflict (name) do nothing
      `;
      await sql`
        insert into invoice_number_counters (name, last_number)
        values ('invoice', 0)
        on conflict (name) do nothing
      `;
      await sql`
        insert into notification_channel_settings (id, channel, audience, topic, is_active)
        values ('inapp:admin:low_stock', 'inapp', 'admin', 'low_stock', true)
        on conflict (channel, audience, topic) do update set is_active = true
      `;

      // 1. Checkout #1 buys 1 unit of Red (4 -> 3, crossing threshold 3):
      //    must enqueue 1 low_stock outbox row after commit.
      const chk1 = await createOrderUsing(sql, {
        txnid: `CHK1_${tag.toUpperCase()}`,
        items: [
          {
            id: prodId,
            name: 'Gadzio Armor Case',
            variantId: redVarId,
            variantSku: `SKU-RED-${tag}`,
            variantLabel: 'iPhone 16 · Red',
            deviceModelId: modelId,
            deviceModelName: 'iPhone 16',
            colourName: 'Red',
            quantity: 1,
            unitPrice: 100,
            totalPrice: 100,
          },
        ],
        subtotalPaise: 10000,
        shippingPaise: 0,
        totalPaise: 10000,
        currency: 'INR',
        customerName: 'Asha',
        customerEmail: 'asha@example.test',
        customerPhone: '9876543210',
        reservationSeconds: 600,
        shippingAddress: {
          name: 'Asha',
          phone: '9876543210',
          line1: '1 Main St',
          line2: '',
          city: 'Pune',
          state: 'Maharashtra',
          pincode: '411001',
        },
      });

      let outbox = await sql`
        select event_key, entity_id, subject, body, dedupe_key
        from notification_outbox
        where event_key = 'low_stock'
        order by created_at asc
      `;
      assert.equal(outbox.length, 1, 'crossing 4 -> 3 enqueues one low_stock alert after commit');
      assert.equal(String(outbox[0].entity_id), prodId);
      assert.match(String(outbox[0].body), /Gadzio Armor Case — iPhone 16 · Red/);

      // Repeating enqueueOrderLowStockAlerts for the same order is a no-op (dedupe by movement token)
      await enqueueOrderLowStockAlerts(chk1.order.id, { sql });
      outbox = await sql`select id from notification_outbox where event_key = 'low_stock'`;
      assert.equal(outbox.length, 1, 'duplicate call for same crossing does not create a second row');

      // 2. Checkout #2 buys another 1 unit of Red (3 -> 2, already at/below threshold 3):
      //    must NOT enqueue another low_stock alert!
      await createOrderUsing(sql, {
        txnid: `CHK2_${tag.toUpperCase()}`,
        items: [
          {
            id: prodId,
            name: 'Gadzio Armor Case',
            variantId: redVarId,
            variantSku: `SKU-RED-${tag}`,
            variantLabel: 'iPhone 16 · Red',
            deviceModelId: modelId,
            deviceModelName: 'iPhone 16',
            colourName: 'Red',
            quantity: 1,
            unitPrice: 100,
            totalPrice: 100,
          },
        ],
        subtotalPaise: 10000,
        shippingPaise: 0,
        totalPaise: 10000,
        currency: 'INR',
        customerName: 'Asha',
        customerEmail: 'asha@example.test',
        customerPhone: '9876543210',
        reservationSeconds: 600,
        shippingAddress: {
          name: 'Asha',
          phone: '9876543210',
          line1: '1 Main St',
          line2: '',
          city: 'Pune',
          state: 'Maharashtra',
          pincode: '411001',
        },
      });
      outbox = await sql`select id from notification_outbox where event_key = 'low_stock'`;
      assert.equal(outbox.length, 1, 'staying low (3 -> 2) does not re-alert');

      // 3. POS sale buys 3 units of Black (5 -> 2, crossing Black's threshold 2):
      //    must enqueue 1 low_stock alert for Black after the POS sale commits!
      await sql`insert into pos_shifts (staff_id, opening_float_paise, status) values (${staffId}, 0, 'OPEN')`;
      const posSale = await createPosSaleUsing(sql, {
        lines: [{ id: prodId, variantId: blkVarId, quantity: 3, unitPricePaise: 10000 }],
        method: 'cash',
        providerRef: null,
        customerPhone: null,
        staffId,
        role: 'store_owner',
      });
      assert.equal(posSale.ok, true);

      outbox = await sql`
        select body, dedupe_key
        from notification_outbox
        where event_key = 'low_stock'
        order by created_at asc
      `;
      assert.equal(outbox.length, 2, 'POS sale crossing Black 5 -> 2 enqueues low_stock alert for Black');
      assert.match(String(outbox[1].body), /Gadzio Armor Case — iPhone 16 · Black \(2 left\)/);
    } finally {
      await dropFixtureSchema(sql, schema);
      await sql.end({ timeout: 5 });
    }
  },
);
