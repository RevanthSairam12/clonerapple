/**
 * Phase 5 option surfaces, offline half.
 *
 * These are source-contract assertions: the admin must name the exact option
 * (device model and colour) everywhere it shows an order line or a stock
 * number, and each report must say it is reporting per product or per option.
 * The database half — real claims, releases, reclaims, returns and price
 * edits — lives in `phase5-option-lifecycle.test.mjs`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createJiti } from 'jiti';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jiti = createJiti(import.meta.url, { moduleCache: false, alias: { '@': path.join(root, 'src') } });
const snapshot = await jiti.import(path.join(root, 'src/lib/orders/option-snapshot.ts'));
const { reportDefinition } = await jiti.import(path.join(root, 'src/lib/store-admin/report-rules.ts'));
const source = (relative) => readFile(path.join(root, relative), 'utf8');

test('an order line names the exact option, model first and colour second', () => {
  assert.equal(
    snapshot.optionSnapshotLabel({ deviceModelName: 'iPhone 16', colourName: 'Red' }),
    'iPhone 16 · Red',
  );
  assert.equal(
    snapshot.optionSnapshotLabel({ deviceModelName: 'iPhone 16', colourName: '   ' }),
    'iPhone 16',
  );
  // Old orders keep the label they stored; nothing is rewritten.
  assert.equal(snapshot.optionSnapshotLabel({ variantLabel: 'Red / 256 GB' }), 'Red / 256 GB');
  assert.equal(snapshot.optionSnapshotLabel({}), null);
  assert.deepEqual(
    snapshot.optionSnapshotColour({ colourName: 'Red', colourHex: '#ff0000' }),
    { name: 'Red', hex: '#FF0000' },
  );
  assert.equal(snapshot.optionSnapshotColour({ colourName: 'Red', colourHex: 'red' }).hex, null);
});

test('orders list, order detail, packing slip and invoice all show the option sold', async () => {
  const orders = await source('src/lib/store-admin/orders.ts');
  // The quick view under each order row aggregates the per-line snapshot.
  assert.match(orders, /'deviceModelName', to_jsonb\(oi\)->>'variant_device_model_name'/);
  assert.match(orders, /'colourName', to_jsonb\(oi\)->>'variant_colour_name'/);
  assert.match(orders, /order by oi\.line_number/);
  assert.match(orders, /variantLabel: optionSnapshotLabel\(\{/);
  // Order detail reads the snapshot columns and labels the line from them.
  assert.match(orders, /variant_device_model_name' as variant_device_model_name/);
  assert.match(orders, /colourName: nullableText\(row\.variant_colour_name\)/);

  // Both printed documents are built from the same detail, so they cannot drift.
  const documents = await source('src/lib/store-admin/order-documents.ts');
  assert.match(documents, /const detail = await getOrderDetail\(txnid, role\)/);
  assert.match(documents, /\.\.\.detail\.data/);
  const slip = await source('src/app/(store-admin)/store-admin/(protected)/orders/[txnid]/packing-slip/page.tsx');
  assert.match(slip, /\{item\.variantLabel && <span className="sa-row-sub">\{item\.variantLabel\}<\/span>\}/);
  const invoice = await source('src/app/(store-admin)/store-admin/(protected)/orders/[txnid]/invoice/page.tsx');
  assert.match(invoice, /<OrderDocument state=\{state\}/);
  const document = await source('src/components/orders/OrderDocument.tsx');
  assert.match(document, /\{item\.variantLabel && <span className="sa-row-sub block text-xs text-\[#6e6e73\]">\{item\.variantLabel\}<\/span>\}/);
});

test('POS snapshots the model and colour it sold and falls back on an older database', async () => {
  const pos = await source('src/lib/store-admin/pos.ts');
  assert.match(pos, /dm\.name as device_model_name, c\.id as colour_id, c\.name as colour_name, c\.hex as colour_hex/);
  assert.match(pos, /variantLabel:\s*optionSnapshotLabel\(optionSnapshot\)/);
  // The write probe covers databases where 0061 has not run yet.
  assert.match(pos, /information_schema\.columns/);
  assert.match(pos, /column_name = 'variant_colour_id'/);
  assert.match(pos, /variant_device_model_id, variant_device_model_name/);
  assert.match(pos, /variant_colour_id, variant_colour_name, variant_colour_hex/);
});

test('stock and low-stock screens report and label per product or option', async () => {
  const crud = await source('src/lib/store-admin/catalog-crud.ts');
  // Product totals skip the retained legacy bucket and untracked rows.
  assert.match(crud, /if \(row\.legacyBucket\) continue;/);
  assert.match(crud, /row\.productOnHand = total\.onHand/);
  // Option rows and movement history name the option through its model.
  assert.match(crud, /coalesce\(nullif\(concat_ws\(' \/ ', dm\.name, nullif\(v\.option_value,''\)\),''\), v\.option_value, v\.sku\) as variant_label/);
  assert.match(crud, /v\.is_active and v\.is_purchasable and v\.retired_at is null/);
  const catalog = await source('src/lib/store-admin/catalog.ts');
  assert.match(catalog, /left join device_models dm on dm\.id = v\.device_model_id/);
  assert.match(catalog, /v\.sku as variant_sku/);
  const lowStockPage = await source('src/app/(store-admin)/store-admin/(protected)/low-stock/page.tsx');
  assert.match(lowStockPage, /A product sold by option is listed once per option/);
  assert.match(lowStockPage, /<th>Product or option<\/th>/);
  const stockPage = await source('src/app/(store-admin)/store-admin/(protected)/stock/page.tsx');
  assert.match(stockPage, /Product total: \$\{row\.productOnHand\} in stock · \$\{row\.productAvailable\} available/);
  assert.match(stockPage, /Products or options at or below the warning level/);
});

test('the stock and low-stock reports say they report per option', () => {
  const stock = reportDefinition('stock');
  assert.match(stock.howCalculated, /each purchasable option/);
  assert.match(stock.description, /every stocked item or option/);
  const low = reportDefinition('low-stock');
  assert.match(low.howCalculated, /product or option/);
});

test('price history names the option and the SKU it changed', async () => {
  const catalog = await source('src/lib/store-admin/catalog.ts');
  assert.match(catalog, /left join product_variants v on v\.id = ph\.variant_id and v\.product_id = ph\.product_id/);
  assert.match(catalog, /left join device_models dm on dm\.id = v\.device_model_id/);
  assert.match(catalog, /v\.sku as variant_sku/);
  // The stored model/option is shown; the live variant is only a fallback.
  assert.match(catalog, /variantSku:[\s\S]{0,160}variant\?\.sku/);
});

test('a return restocks only the option sold, capped by the ledger', async () => {
  const returns = await source('src/lib/store-admin/returns.ts');
  assert.match(returns, /select ri\.quantity, ri\.condition_grade, ri\.restock, oi\.product_id, oi\.variant_id/);
  assert.match(returns, /variantId: item\.variant_id \? text\(item\.variant_id\) : null/);
  assert.match(returns, /restoreSoldStock\(/);
  const stock = await source('src/lib/payu/stock.ts');
  // The cap lives in the engine, so no caller can restore more than was sold.
  assert.match(stock, /restoreableQuantity\(line\.quantity,balance\?\.claimed \?\? 0,balance\?\.restored \?\? 0\)/);
});

test('a price edit writes only the option, its history and the audit trail', async () => {
  const draft = await source('src/lib/store-admin/product-draft.ts');
  const start = draft.indexOf('export async function updateVariantPricingUsing');
  const end = draft.indexOf('export async function saveProductDraft', start);
  const body = draft.slice(start, end);
  assert.match(body, /from product_variants where id=\$\{variantId\} and product_id=\$\{productId\} for update/);
  assert.match(body, /update product_variants set price_paise_override=/);
  assert.match(body, /insert into price_history\(/);
  assert.match(body, /strictMetadataAudit\(/);
  // No order, coupon, stock or reservation write may appear in a price edit.
  for (const forbidden of [
    /update orders\b/,
    /update order_items\b/,
    /coupon_redemptions/,
    /update stock\b/,
    /stock_movements/,
    /reservation_state/,
  ]) {
    assert.doesNotMatch(body, forbidden);
  }
});

test('the sale page lists a row per option at that option’s own price', async () => {
  const sale = await source('src/lib/store-admin/sale.ts');
  assert.match(sale, /product_variants/);
  assert.match(sale, /pricePaiseOverride|price_paise_override/);
  assert.match(sale, /stock/);
});
