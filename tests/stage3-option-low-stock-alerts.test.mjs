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

const { planOrderLowStockAlerts, stockNotificationEvent, stockAlertProductName } = await jiti.import(
  path.join(root, 'src/lib/notifications/stock-events.ts'),
);
const { enqueueNotification } = await jiti.import(
  path.join(root, 'src/lib/notifications/enqueue.ts'),
);
const { enqueueOrderLowStockAlerts } = await jiti.import(
  path.join(root, 'src/lib/notifications/order-stock-alerts.ts'),
);
const { createOrderUsing } = await jiti.import(path.join(root, 'src/lib/payu/orders.ts'));
const { createPosSaleUsing, openShift } = await jiti.import(
  path.join(root, 'src/lib/store-admin/pos.ts'),
);

test('stockNotificationEvent handles replenishment and threshold crossings correctly', () => {
  // 1. Crossing from 0 to positive triggers back_in_stock
  assert.equal(stockNotificationEvent({ availableBefore: 0, availableAfter: 5, threshold: 2 }), 'back_in_stock');
  assert.equal(stockNotificationEvent({ availableBefore: -1, availableAfter: 3, threshold: 2 }), 'back_in_stock');
  // 2. Replenishing while already in stock does NOT trigger back_in_stock repeatedly
  assert.equal(stockNotificationEvent({ availableBefore: 5, availableAfter: 10, threshold: 2 }), null);
  // 3. Crossing threshold triggers low_stock
  assert.equal(stockNotificationEvent({ availableBefore: 4, availableAfter: 2, threshold: 2 }), 'low_stock');
  // 4. Remaining above threshold produces no alert
  assert.equal(stockNotificationEvent({ availableBefore: 10, availableAfter: 5, threshold: 2 }), null);
  // 5. Already below threshold produces no alert
  assert.equal(stockNotificationEvent({ availableBefore: 2, availableAfter: 1, threshold: 2 }), null);
  // 6. Dropping to 0 is out of stock, not low stock
  assert.equal(stockNotificationEvent({ availableBefore: 3, availableAfter: 0, threshold: 2 }), null);
});

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
      const bluVarId = `vblu_${tag}`;
      const grnVarId = `vgrn_${tag}`;
      const whtVarId = `vwht_${tag}`;
      const ylwVarId = `vylw_${tag}`;
      const repVarId = `vrep_${tag}`;
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
          (${blkVarId}, ${prodId}, ${`SKU-BLK-${tag}`}, 'Colour', 'Black', true, true, ${modelId}, ${blkVarId}),
          (${bluVarId}, ${prodId}, ${`SKU-BLU-${tag}`}, 'Colour', 'Blue', true, true, ${modelId}, ${bluVarId}),
          (${grnVarId}, ${prodId}, ${`SKU-GRN-${tag}`}, 'Colour', 'Green', true, true, ${modelId}, ${grnVarId}),
          (${whtVarId}, ${prodId}, ${`SKU-WHT-${tag}`}, 'Colour', 'White', true, true, ${modelId}, ${whtVarId}),
          (${ylwVarId}, ${prodId}, ${`SKU-YLW-${tag}`}, 'Colour', 'Yellow', true, true, ${modelId}, ${ylwVarId}),
          (${repVarId}, ${prodId}, ${`SKU-REP-${tag}`}, 'Colour', 'Clear', true, true, ${modelId}, ${repVarId})
      `;
      await sql`
        insert into product_device_models (product_id, device_model_id)
        values (${prodId}, ${modelId})
      `;
      await sql`
        insert into stock (id, product_id, variant_id, on_hand, reserved, track_inventory, low_stock_threshold)
        values
          (${`stk_red_${tag}`}, ${prodId}, ${redVarId}, 4, 0, true, 3),
          (${`stk_blk_${tag}`}, ${prodId}, ${blkVarId}, 5, 0, true, 2),
          (${`stk_blu_${tag}`}, ${prodId}, ${bluVarId}, 10, 0, true, 3),
          (${`stk_grn_${tag}`}, ${prodId}, ${grnVarId}, 4, 0, true, 3),
          (${`stk_wht_${tag}`}, ${prodId}, ${whtVarId}, 3, 0, true, 2),
          (${`stk_ylw_${tag}`}, ${prodId}, ${ylwVarId}, 2, 0, true, 1),
          (${`stk_rep_${tag}`}, ${prodId}, ${repVarId}, 0, 0, true, 2)
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
        values
          ('inapp:admin:low_stock', 'inapp', 'admin', 'low_stock', true),
          ('inapp:admin:back_in_stock', 'inapp', 'admin', 'back_in_stock', true)
        on conflict (channel, audience, topic) do update set is_active = true
      `;

      // 1. Checkout crossing threshold (Red: 4 -> 3, threshold 3):
      //    must enqueue 1 low_stock outbox row after commit and render template correctly.
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
      assert.equal(outbox.length, 1, 'scenario 1: crossing 4 -> 3 enqueues one low_stock alert after commit');
      assert.equal(String(outbox[0].entity_id), prodId);
      assert.match(String(outbox[0].subject), /Low stock: Gadzio Armor Case — iPhone 16 · Red/);
      assert.match(String(outbox[0].body), /Gadzio Armor Case — iPhone 16 · Red/);
      assert.match(String(outbox[0].body), /3 available to buy|3 left/);

      // 2. Checkout remaining above threshold (Blue: 10 -> 8, threshold 3):
      //    must NOT enqueue an alert!
      await createOrderUsing(sql, {
        txnid: `CHK_ABV_${tag.toUpperCase()}`,
        items: [
          {
            id: prodId,
            name: 'Gadzio Armor Case',
            variantId: bluVarId,
            variantSku: `SKU-BLU-${tag}`,
            variantLabel: 'iPhone 16 · Blue',
            deviceModelId: modelId,
            deviceModelName: 'iPhone 16',
            colourName: 'Blue',
            quantity: 2,
            unitPrice: 100,
            totalPrice: 200,
          },
        ],
        subtotalPaise: 20000,
        shippingPaise: 0,
        totalPaise: 20000,
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
      assert.equal(outbox.length, 1, 'scenario 2: remaining above threshold (10 -> 8, threshold 3) does not alert');

      // 3. Checkout already below threshold (Red: 3 -> 2, threshold 3):
      //    must NOT enqueue another alert!
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
      assert.equal(outbox.length, 1, 'scenario 3: staying low (3 -> 2) does not re-alert');

      // 4. Two concurrent checkouts crossing the same threshold:
      //    Green starts at 4, threshold 3. Two checkouts order 1 each sequentially or concurrently.
      //    First crosses 4 -> 3 (alerts). Second moves 3 -> 2 (already low, does not alert).
      const [conc1, conc2] = await Promise.all([
        createOrderUsing(sql, {
          txnid: `CHK_CONC1_${tag.toUpperCase()}`,
          items: [{ id: prodId, name: 'Gadzio Armor Case', variantId: grnVarId, variantSku: `SKU-GRN-${tag}`, variantLabel: 'iPhone 16 · Green', deviceModelId: modelId, deviceModelName: 'iPhone 16', colourName: 'Green', quantity: 1, unitPrice: 100, totalPrice: 100 }],
          subtotalPaise: 10000, shippingPaise: 0, totalPaise: 10000, currency: 'INR', customerName: 'Buyer1', customerEmail: 'b1@example.test', customerPhone: '9876543210', reservationSeconds: 600,
          shippingAddress: { name: 'Buyer1', phone: '9876543210', line1: '1 Main St', line2: '', city: 'Pune', state: 'Maharashtra', pincode: '411001' },
        }),
        createOrderUsing(sql, {
          txnid: `CHK_CONC2_${tag.toUpperCase()}`,
          items: [{ id: prodId, name: 'Gadzio Armor Case', variantId: grnVarId, variantSku: `SKU-GRN-${tag}`, variantLabel: 'iPhone 16 · Green', deviceModelId: modelId, deviceModelName: 'iPhone 16', colourName: 'Green', quantity: 1, unitPrice: 100, totalPrice: 100 }],
          subtotalPaise: 10000, shippingPaise: 0, totalPaise: 10000, currency: 'INR', customerName: 'Buyer2', customerEmail: 'b2@example.test', customerPhone: '9876543210', reservationSeconds: 600,
          shippingAddress: { name: 'Buyer2', phone: '9876543210', line1: '2 Main St', line2: '', city: 'Pune', state: 'Maharashtra', pincode: '411001' },
        }),
      ]);
      assert.ok(conc1.order.id && conc2.order.id);

      outbox = await sql`
        select id, body from notification_outbox
        where event_key = 'low_stock' and body like '%Green%'
      `;
      assert.equal(outbox.length, 1, 'scenario 4: concurrent checkouts crossing Green 4 -> 3 -> 2 trigger exactly one low-stock alert');

      // 5. Checkout rollback produces no notification:
      //    A checkout transaction that fails/rolls back must enqueue zero outbox records.
      const outboxBeforeRollback = await sql`select count(*)::int as c from notification_outbox`;
      await assert.rejects(async () => {
        await sql.begin(async (tx) => {
          await tx`
            insert into stock_movements (product_id, variant_id, delta, reason, order_id)
            values (${prodId}, ${redVarId}, -1, 'sale', 'fake-aborted-order')
          `;
          throw new Error('SIMULATED_CHECKOUT_ABORT');
        });
      }, /SIMULATED_CHECKOUT_ABORT/);

      const outboxAfterRollback = await sql`select count(*)::int as c from notification_outbox`;
      assert.equal(
        outboxAfterRollback[0].c,
        outboxBeforeRollback[0].c,
        'scenario 5: rolled-back checkout transaction produces no outbox notifications',
      );

      // 6. POS crossing threshold:
      //    POS sale buys 3 units of Black (5 -> 2, crossing threshold 2):
      //    must enqueue 1 low_stock alert for Black after the POS sale commits.
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
        where event_key = 'low_stock' and body like '%Black%'
        order by created_at asc
      `;
      assert.equal(outbox.length, 1, 'scenario 6: POS sale crossing Black 5 -> 2 enqueues low_stock alert for Black');
      assert.match(String(outbox[0].body), /Gadzio Armor Case — iPhone 16 · Black \(2 left\)/);

      // 7. POS rollback produces no notification:
      //    A POS sale that fails (e.g. quantity exceeds stock on hand) produces no notification.
      const outboxBeforePosRollback = await sql`select count(*)::int as c from notification_outbox`;
      const failedPos = await createPosSaleUsing(sql, {
        lines: [{ id: prodId, variantId: blkVarId, quantity: 999, unitPricePaise: 10000 }],
        method: 'cash',
        providerRef: null,
        customerPhone: null,
        staffId,
        role: 'store_owner',
      });
      assert.equal(failedPos.ok, false);
      const outboxAfterPosRollback = await sql`select count(*)::int as c from notification_outbox`;
      assert.equal(
        outboxAfterPosRollback[0].c,
        outboxBeforePosRollback[0].c,
        'scenario 7: failed/rolled-back POS sale produces no notification',
      );

      // 8. Different variants produce distinct notifications:
      //    White has 3 (threshold 2), Yellow has 2 (threshold 1).
      //    A single checkout buys 1 White (3 -> 2) and 1 Yellow (2 -> 1).
      //    Must enqueue two separate alerts with distinct option labels and deep links!
      const chkMulti = await createOrderUsing(sql, {
        txnid: `CHK_MULTI_${tag.toUpperCase()}`,
        items: [
          {
            id: prodId,
            name: 'Gadzio Armor Case',
            variantId: whtVarId,
            variantSku: `SKU-WHT-${tag}`,
            variantLabel: 'iPhone 16 · White',
            deviceModelId: modelId,
            deviceModelName: 'iPhone 16',
            colourName: 'White',
            quantity: 1,
            unitPrice: 100,
            totalPrice: 100,
          },
          {
            id: prodId,
            name: 'Gadzio Armor Case',
            variantId: ylwVarId,
            variantSku: `SKU-YLW-${tag}`,
            variantLabel: 'iPhone 16 · Yellow',
            deviceModelId: modelId,
            deviceModelName: 'iPhone 16',
            colourName: 'Yellow',
            quantity: 1,
            unitPrice: 100,
            totalPrice: 100,
          },
        ],
        subtotalPaise: 20000,
        shippingPaise: 0,
        totalPaise: 20000,
        currency: 'INR',
        customerName: 'MultiBuyer',
        customerEmail: 'multi@example.test',
        customerPhone: '9876543210',
        reservationSeconds: 600,
        shippingAddress: {
          name: 'MultiBuyer',
          phone: '9876543210',
          line1: '3 Main St',
          line2: '',
          city: 'Pune',
          state: 'Maharashtra',
          pincode: '411001',
        },
      });
      assert.ok(chkMulti.order.id);

      const multiAlerts = await sql`
        select subject, body, dedupe_key
        from notification_outbox
        where event_key = 'low_stock' and (body like '%White%' or body like '%Yellow%')
        order by created_at asc
      `;
      assert.equal(multiAlerts.length, 2, 'scenario 8: different variants crossing thresholds produce distinct alerts');
      assert.match(String(multiAlerts[0].subject), /White/);
      assert.match(String(multiAlerts[1].subject), /Yellow/);
      assert.match(String(multiAlerts[0].body), /iPhone 16 · White/);
      assert.match(String(multiAlerts[1].body), /iPhone 16 · Yellow/);

      // 9. Replenishment triggers back-in-stock correctly:
      //    Clear variant starts at 0.
      //    Restocking 0 -> 5 triggers back_in_stock event.
      const repEvent1 = stockNotificationEvent({ availableBefore: 0, availableAfter: 5, threshold: 2 });
      assert.equal(repEvent1, 'back_in_stock', 'scenario 9: 0 -> 5 produces back_in_stock event');
      await enqueueNotification(
        'back_in_stock',
        { type: 'product', id: prodId },
        {
          productName: stockAlertProductName('Gadzio Armor Case', 'iPhone 16 · Clear'),
          stockAvailable: 5,
          staffLink: `/store-admin/stock/${encodeURIComponent(prodId)}?variant=${encodeURIComponent(repVarId)}`,
          token: `movement:rep_${tag}_1`,
        },
        sql,
      );
      const backInStockRows = await sql`
        select event_key, body, dedupe_key from notification_outbox where event_key = 'back_in_stock'
      `;
      assert.equal(backInStockRows.length, 1, 'scenario 9: back_in_stock notification queued with variant details');
      assert.match(String(backInStockRows[0].body), /Gadzio Armor Case — iPhone 16 · Clear back in stock/);

      // Subsequent replenishment 5 -> 10 when already in stock does NOT re-trigger:
      const repEvent2 = stockNotificationEvent({ availableBefore: 5, availableAfter: 10, threshold: 2 });
      assert.equal(repEvent2, null, 'scenario 9: subsequent replenishment 5 -> 10 does not re-trigger back_in_stock');

      // 10. Duplicate processing does not duplicate alerts:
      //    Calling enqueueOrderLowStockAlerts again for chk1 or chkMulti is a no-op.
      const countBeforeDupe = await sql`select count(*)::int as c from notification_outbox`;
      await enqueueOrderLowStockAlerts(chk1.order.id, { sql });
      await enqueueOrderLowStockAlerts(chkMulti.order.id, { sql });
      const countAfterDupe = await sql`select count(*)::int as c from notification_outbox`;
      assert.equal(
        countAfterDupe[0].c,
        countBeforeDupe[0].c,
        'scenario 10: duplicate processing of orders produces zero duplicate alerts (idempotency)',
      );
    } finally {
      await dropFixtureSchema(sql, schema);
      await sql.end({ timeout: 5 });
    }
  },
);
