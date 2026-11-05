import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createJiti } from 'jiti';

const root = path.resolve(import.meta.dirname, '..');
const jiti = createJiti(import.meta.url, { moduleCache: false, alias: { '@': path.join(root, 'src') } });
const snapshot = await jiti.import(path.join(root, 'src/lib/orders/option-snapshot.ts'));
const read = file => readFileSync(path.join(root, file), 'utf8');

test('a snapshot names the model and colour it sold, and legacy rows fall back to their label', () => {
  assert.equal(snapshot.optionSnapshotLabel({ deviceModelName: 'iPhone 16', colourName: 'Red' }), 'iPhone 16 · Red');
  assert.equal(snapshot.optionSnapshotLabel({ deviceModelName: 'iPhone 16', colourName: null }), 'iPhone 16');
  assert.equal(snapshot.optionSnapshotLabel({ colourName: ' Red ' }), 'Red');
  assert.equal(snapshot.optionSnapshotLabel({ deviceModelName: '  ', colourName: '' }), null);
  // Orders written before 0061 keep their stored label.
  assert.equal(snapshot.optionSnapshotLabel({ variantLabel: 'Natural Titanium / 256 GB' }), 'Natural Titanium / 256 GB');
  assert.equal(snapshot.optionSnapshotLabel({}), null);
});

test('the colour snapshot keeps a valid hex and never invents one', () => {
  assert.deepEqual(snapshot.optionSnapshotColour({ colourName: 'Black', colourHex: '#1d1d1f' }),
    { name: 'Black', hex: '#1D1D1F' });
  assert.deepEqual(snapshot.optionSnapshotColour({ colourName: 'Red', colourHex: 'red' }), { name: 'Red', hex: null });
  assert.equal(snapshot.optionSnapshotColour({ colourHex: '#FF0000' }), null);
  assert.equal(snapshot.optionSnapshotColour({}), null);
});

test('the sold photo wins over the live catalogue and always has alt text', () => {
  assert.deepEqual(snapshot.optionSnapshotImage({ imageUrl: '/sold.png', imageAlt: 'Sold photo' }, '/live.png', 'Fallback'),
    { url: '/sold.png', alt: 'Sold photo' });
  // A replaced or deleted photo still shows what the order sold.
  assert.deepEqual(snapshot.optionSnapshotImage({ imageUrl: '/sold.png' }, '/live.png', 'Fallback'),
    { url: '/sold.png', alt: 'Fallback' });
  // Legacy lines fall back to the live catalogue image.
  assert.deepEqual(snapshot.optionSnapshotImage({}, '/live.png', 'Fallback'), { url: '/live.png', alt: 'Fallback' });
  assert.deepEqual(snapshot.optionSnapshotImage({ variantLabel: 'iPhone 16 / Red' }, null, 'Fallback'),
    null);
  assert.equal(snapshot.optionSnapshotImage({ imageUrl: '   ' }, null, 'Fallback'), null);
});

test('receipt, invoice, order detail and store admin render the snapshot text and photo', () => {
  const receipt = read('src/app/account/orders/[txnid]/receipt/page.tsx');
  assert.match(receipt, /variantLabel: optionSnapshotLabel\(item\) \?\? item\.variantLabel/);
  assert.match(receipt, /imageUrl: item\.image, imageAlt: item\.imageAlt \?\? item\.name/);

  const detail = read('src/app/account/orders/[txnid]/page.tsx');
  assert.match(detail, /alt=\{item\.imageAlt \?\? item\.name\}/);
  assert.match(detail, /\{optionSnapshotLabel\(item\) &&/);

  const document = read('src/components/orders/OrderDocument.tsx');
  assert.match(document, /src=\{item\.imageUrl\}/);
  assert.match(document, /alt=\{item\.imageAlt \?\? item\.productName\}/);

  const admin = read('src/lib/store-admin/orders.ts');
  assert.match(admin, /optionSnapshotLabel/);
  assert.match(admin, /variantLabel: optionSnapshotLabel/);
  assert.match(admin, /to_jsonb\(order_items\)->>'image_url'/);
});
