import test from 'node:test';
import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const jiti = createJiti(import.meta.url, { fsCache: false, jsx: { runtime: 'automatic' }, alias: { '@': new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') } });
const { normalizeHomepageSlots, validateHomepageSlots, resolveHomepageSlots } = await jiti.import('../src/lib/website/homepage-products.ts');
const { validateLegacyContentWrite } = await jiti.import('../src/lib/website/boundary.ts');
const key = 'gadzio.diwali_campaign';
const selection = { enabled: true, items: ['a', 'b', 'c', 'd'].map(productId => ({ productId })) };

test('normalization fixes counts, preserves copy and only infers product links', () => {
  const normalized = normalizeHomepageSlots(key, { bannerTitle: 'Festive', items: [{ href: '/shop/product/a', title: 'Old' }, { href: '/category/cases' }] });
  assert.equal(normalized.bannerTitle, 'Festive');
  assert.equal(normalized.items.length, 4);
  assert.deepEqual(normalized.items[0], { productId: 'a' });
  assert.equal(normalized.items[1].productId, '');
  assert.equal(normalizeHomepageSlots('gadzio.crowd_favorites', {}).items.length, 6);
});

test('save shape refuses missing, duplicate and copied product fields', () => {
  assert.equal(validateHomepageSlots(key, selection), null);
  assert.ok(validateHomepageSlots(key, { items: selection.items.slice(1) }));
  assert.ok(validateHomepageSlots(key, { items: [...selection.items.slice(0, 3), { productId: 'A' }] }));
  assert.ok(validateHomepageSlots(key, { items: [{ productId: 'a', amountText: '₹1' }, ...selection.items.slice(1)] }));
  assert.ok(validateHomepageSlots(key, { items: [{ productId: '' }, ...selection.items.slice(1)] }));
});

test('only the store-admin opt-in allows exact reference paths', () => {
  assert.equal(validateLegacyContentWrite(key, selection).ok, false);
  assert.equal(validateLegacyContentWrite(key, selection, true).ok, true);
  assert.equal(validateLegacyContentWrite('other', selection, true).ok, false);
  assert.equal(validateLegacyContentWrite(key, { ...selection, nested: { productId: 'a' } }, true).ok, false);
  assert.equal(validateLegacyContentWrite(key, { ...selection, price: 1 }, true).ok, false);
});

const product = { id: 'b', name: 'Live name', image: '/live.jpg', href: '/shop/product/b', pricePaise: 15000, priceDisplay: '₹150', regularPricePaise: 20000, onSale: true, compareAtPaise: null, colors: [{ hex: '#123456' }] };
test('resolution retains positions, current catalog values and sale savings', () => {
  const resolved = resolveHomepageSlots(key, selection, [product]);
  assert.equal(resolved.items.length, 4);
  assert.equal(resolved.items[0].unavailable, true);
  assert.equal(resolved.items[0].href, '');
  assert.equal(resolved.items[1].title, 'Live name');
  assert.equal(resolved.items[1].amountText, '₹150');
  assert.equal(resolved.items[1].savingsText, 'SAVE 25%');
  assert.equal(resolved.items[1].href, '/shop/product/b');
  assert.equal(resolveHomepageSlots(key, selection, []).items.every(item => item.unavailable), true);
  const changed = resolveHomepageSlots(key, selection, [{ ...product, name: 'Edited catalog name' }]);
  assert.equal(changed.items[1].title, 'Edited catalog name');
});

test('legacy marketing content remains visible until configured', () => {
  const legacy = { items: [{ title: 'Existing', image: '/existing.jpg' }] };
  assert.deepEqual(resolveHomepageSlots(key, legacy, []), legacy);
});

test('favorites use catalog swatches and unavailable cards have no anchor', async () => {
  const resolved = resolveHomepageSlots('gadzio.crowd_favorites', { items: [{ productId: 'b' }] }, [product]);
  assert.equal(resolved.items.length, 6);
  assert.equal(resolved.items[0].colorDots, '#123456');
  const { ProductCardLink } = await jiti.import('../src/components/ProductCardLink.tsx');
  const html = renderToStaticMarkup(React.createElement(ProductCardLink, { unavailable: true, href: '/shop/product/b', className: 'card' }, 'Unavailable'));
  assert.doesNotMatch(html, /<a\b|href=/);
  assert.match(html, /aria-disabled="true"/);
});
