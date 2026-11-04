import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogPath = path.join(root, 'src/lib/store-admin/catalog.ts');
const pagePath = path.join(root, 'src/app/(store-admin)/store-admin/(protected)/products/page.tsx');
const queries = [];
let productRows = [];
const sql = async (strings) => {
  const query = strings.join('?');
  queries.push(query);
  if (/from products p/.test(query)) return productRows;
  return [];
};
const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { '@': path.join(root, 'src') },
  virtualModules: { '@/lib/platform/db': { getSql: () => sql } },
});
const catalog = await jiti.import(catalogPath);
const { mapCatalogOverviewProduct: map, catalogStockLabel: label } = catalog;
const parent = (overrides = {}) => ({
  id: 'case/blue', name: 'Case', catalog_revision: 0, in_stock: true, is_active: true,
  inventory_mode: 'product', stock_id: 'parent-stock', track_inventory: true,
  on_hand: 10, reserved: 3, option_count: 4,
  ...overrides,
});
const variants = (overrides = {}) => parent({
  inventory_mode: 'variant', purchasable_count: 2,
  limited_stock_count: 2, unlimited_stock_count: 0, missing_stock_count: 0,
  variant_available: '7',
  ...overrides,
});

test('limited product stock subtracts reservations and retains option count', () => {
  const product = map(parent());
  assert.equal(product.inventoryMode, 'product');
  assert.equal(product.optionCount, 4);
  assert.equal(product.stockStatus, 'limited');
  assert.equal(product.trackInventory, true);
  assert.equal(product.available, 7);
  assert.equal(product.inStock, true);
  assert.equal(label(product), '7 left');
});

test('zero and over-reserved stock are unavailable, never negative units left', () => {
  for (const on_hand of [0, 3, 2]) {
    const product = map(parent({ on_hand }));
    assert.equal(product.available, 0);
    assert.equal(product.inStock, false);
    assert.equal(label(product), 'Out of stock');
  }
});

test('only an explicit untracked row is unlimited', () => {
  const product = map(parent({ track_inventory: false, on_hand: 0 }));
  assert.equal(product.stockStatus, 'unlimited');
  assert.equal(product.trackInventory, false);
  assert.equal(product.available, null);
  assert.equal(product.inStock, true);
  assert.equal(label(product), 'Not limited');
  const missing = map(parent({ stock_id: null, track_inventory: null }));
  assert.equal(missing.stockStatus, 'missing');
  assert.equal(missing.trackInventory, null);
  assert.equal(missing.available, null);
  assert.equal(missing.inStock, false);
  assert.equal(label(missing), 'Stock setup needed');
});

test('variant inventory uses aggregate units instead of parent balance or tracking', () => {
  const product = map(variants({ track_inventory: false, on_hand: 1000, reserved: 0 }));
  assert.equal(product.stockStatus, 'limited');
  assert.equal(product.inventoryMode, 'variant');
  assert.equal(product.available, 7);
  assert.equal(product.trackInventory, true);
  assert.equal(label(product), '7 left');
  const empty = map(variants({ variant_available: 0 }));
  assert.equal(empty.inStock, false);
  assert.equal(label(empty), 'Out of stock');
});

test('variant inventory supports fully unlimited and mixed stock without false finite totals', () => {
  const unlimited = map(variants({ limited_stock_count: 0, unlimited_stock_count: 2, variant_available: 0 }));
  assert.equal(unlimited.stockStatus, 'unlimited');
  assert.equal(unlimited.inStock, true);
  assert.equal(unlimited.available, null);
  assert.equal(label(unlimited), 'Not limited');
  const mixed = map(variants({ limited_stock_count: 1, unlimited_stock_count: 1, variant_available: 0 }));
  assert.equal(mixed.stockStatus, 'mixed');
  assert.equal(mixed.trackInventory, null);
  assert.equal(mixed.inStock, true);
  assert.equal(mixed.available, null);
  assert.equal(label(mixed), 'Mixed stock limits');
});

test('missing variant rows take precedence over limited, unlimited and mixed rows', () => {
  for (const [limited_stock_count, unlimited_stock_count] of [[1, 0], [0, 1], [1, 1], [0, 0]]) {
    const product = map(variants({
      purchasable_count: limited_stock_count + unlimited_stock_count + 1,
      limited_stock_count, unlimited_stock_count, missing_stock_count: 1,
      variant_available: limited_stock_count ? 7 : 0,
    }));
    assert.equal(product.stockStatus, 'missing');
    assert.equal(product.available, null);
    assert.equal(product.trackInventory, null);
    assert.equal(product.inStock, limited_stock_count + unlimited_stock_count > 0);
    assert.equal(label(product), 'Stock setup needed');
  }
});

test('no active purchasable identities requires setup, not parent fallback', () => {
  const product = map(variants({
    purchasable_count: 0, limited_stock_count: 0, unlimited_stock_count: 0,
    missing_stock_count: 0, variant_available: 0,
  }));
  assert.equal(product.optionCount, 4);
  assert.equal(product.stockStatus, 'missing');
  assert.equal(product.inStock, false);
  assert.equal(label(product), 'Stock setup needed');
});

test('manual unavailable switch wins over both parent and option stock', () => {
  for (const row of [parent(), parent({ track_inventory: false }), variants(), variants({ limited_stock_count: 0, unlimited_stock_count: 2 })]) {
    const product = map({ ...row, in_stock: false });
    assert.equal(product.inStock, false);
    assert.equal(label(product), 'Out of stock');
  }
});

test('overview uses two reads, one exact-identity lateral aggregate and no writes', async () => {
  queries.length = 0;
  productRows = [variants()];
  const result = await catalog.listCatalogOverview();
  assert.equal(result.ok, true);
  assert.equal(queries.length, 2);
  assert.deepEqual(result.data.products, [map(productRows[0])]);
  const query = queries.find((value) => /from products p/.test(value));
  assert.match(query, /left join lateral/);
  assert.match(query, /where v\.product_id = p\.id/);
  assert.match(query, /vs\.product_id = v\.product_id and vs\.variant_id = v\.id/);
  assert.match(query, /s\.product_id = p\.id and s\.variant_id is null/);
  assert.match(query, /count\(\*\)::int as option_count/);
  for (const field of ['purchasable_count', 'missing_stock_count', 'limited_stock_count', 'unlimited_stock_count']) {
    assert.match(query, new RegExp(`count\\(\\*\\) filter \\(where v\\.is_active and v\\.is_purchasable[^)]*\\)::int as ${field}`));
  }
  assert.match(query, /vs\.id is null/);
  assert.match(query, /sum\(greatest\(0, vs\.on_hand - vs\.reserved\)\) filter/);
  assert.match(query, /where v\.is_active and v\.is_purchasable and vs\.track_inventory/);
  assert.doesNotMatch(queries.join('\n'), /\b(insert|update|delete|alter|create)\b/i);
});

test('detail mapping preserves manual availability and parent tracking semantics', async () => {
  productRows = [variants()];
  const result = await catalog.getCatalogProduct('case/blue');
  assert.equal(result.ok, true);
  assert.equal(result.data.inStock, true);
  assert.equal(result.data.inventoryMode, 'variant');
  assert.equal(result.data.trackInventory, null);
  assert.equal(result.data.stock, null);
  for (const key of ['optionCount', 'available', 'stockStatus']) assert.equal(key in result.data, false);
});

async function renderProducts(products, role = 'store_admin') {
  const pageJiti = createJiti(import.meta.url, {
    moduleCache: false,
    jsx: { runtime: 'automatic' },
    alias: { '@': path.join(root, 'src') },
    virtualModules: {
      'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
      '@/lib/store-admin/auth': { getStoreSession: async () => ({ role }) },
      '@/lib/store-admin/product-metadata': { loadMetadataEditor: async () => ({ state: { reviewed: true, problems: [] } }) },
      '@/lib/store-admin/catalog': { ...catalog, listCatalogOverview: async () => ({ ok: true, data: { categories: [], products } }) },
    },
  });
  const { default: Page } = await pageJiti.import(pagePath);
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
}

test('listing renders sub-item count, encoded options/stock links and stock labels', async () => {
  const html = await renderProducts([
    map(parent()), map(parent({ id: 'missing', stock_id: null, track_inventory: null })),
    map(variants({ id: 'mixed', limited_stock_count: 1, unlimited_stock_count: 1 })),
  ]);
  assert.match(html, /4 sub-items • Edit colors\/models/);
  assert.match(html, /href="\/store-admin\/products\/case%2Fblue#product-step-2"/);
  assert.match(html, /href="\/store-admin\/products\/case%2Fblue#product-step-3"/);
  assert.match(html, />7 left</);
  assert.match(html, />Stock setup needed</);
  assert.match(html, />Mixed stock limits</);
});

test('oversell notice excludes limited/missing/unavailable products and includes mixed limits', async () => {
  const safe = [map(parent()), map(parent({ id: 'missing', stock_id: null, track_inventory: null })), map(parent({ id: 'off', track_inventory: false, in_stock: false }))];
  assert.doesNotMatch(await renderProducts(safe), /can be oversold/);
  const html = await renderProducts([...safe, map(variants({ id: 'mixed', limited_stock_count: 1, unlimited_stock_count: 1 }))]);
  assert.match(html, /1 active product.*have no stock limit and can be oversold/);
});

test('viewer can inspect options without being offered stock editing', async () => {
  const html = await renderProducts([map(parent())], 'store_viewer');
  assert.match(html, /4 sub-items • View colors\/models/);
  assert.doesNotMatch(html, /href="[^"]*#product-step-3"|>Edit colors\/models<|href="\/store-admin\/products\/new"/);
  assert.match(html, /Help for Stock for Case/);
});
