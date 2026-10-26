import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const here = path.dirname(fileURLToPath(import.meta.url));
const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { '@': path.join(here, '..', 'src') },
});

const {
  MAX_MEDIA_BYTES,
  altError,
  cleanFilename,
  imageDimensions,
  isAllowedMediaType,
  sniffMime,
} = await jiti.import(path.join(here, '..', 'src', 'lib', 'store-admin', 'media-rules.ts'));

const PNG_HEADER = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function bytes(...values) {
  return Uint8Array.from(values);
}

test('the content type is sniffed from magic bytes, not the extension', () => {
  assert.equal(sniffMime(bytes(0xff, 0xd8, 0xff, 0xe0)), 'image/jpeg');
  assert.equal(sniffMime(PNG_HEADER), 'image/png');
  assert.equal(sniffMime(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)), 'image/gif');

  const webp = new Uint8Array(16);
  webp.set([0x52, 0x49, 0x46, 0x46], 0);
  webp.set([0x57, 0x45, 0x42, 0x50], 8);
  assert.equal(sniffMime(webp), 'image/webp');

  const mp4 = new Uint8Array(16);
  mp4.set([0x66, 0x74, 0x79, 0x70], 4);
  assert.equal(sniffMime(mp4), 'video/mp4');

  const webm = new Uint8Array(8);
  webm.set([0x1a, 0x45, 0xdf, 0xa3], 0);
  assert.equal(sniffMime(webm), 'video/webm');

  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  assert.equal(sniffMime(svg), 'image/svg+xml');
});

test('an HTML file renamed to .png is refused', () => {
  const html = new TextEncoder().encode('<!doctype html><html><script>alert(1)</script></html>');
  assert.equal(sniffMime(html), null);
  assert.equal(sniffMime(new Uint8Array(0)), null);
});

test('only the allowed media types are accepted', () => {
  assert.equal(isAllowedMediaType('image/png'), true);
  assert.equal(isAllowedMediaType('video/mp4'), true);
  assert.equal(isAllowedMediaType('image/svg+xml'), true);
  assert.equal(isAllowedMediaType('application/pdf'), false);
  assert.equal(isAllowedMediaType('text/html'), false);
  assert.equal(MAX_MEDIA_BYTES, 25 * 1024 * 1024);
});

test('PNG and GIF dimensions are read from their headers', () => {
  const png = new Uint8Array(24);
  png.set(PNG_HEADER, 0);
  const view = new DataView(png.buffer);
  view.setUint32(16, 1200);
  view.setUint32(20, 630);
  assert.deepEqual(imageDimensions(png), { width: 1200, height: 630 });

  const gif = new Uint8Array(10);
  gif.set(new TextEncoder().encode('GIF89a'), 0);
  gif[6] = 0x40;
  gif[7] = 0x01; // 320
  gif[8] = 0xc8;
  gif[9] = 0x00; // 200
  assert.deepEqual(imageDimensions(gif), { width: 320, height: 200 });
});

test('JPEG dimensions come from the first SOF segment', () => {
  const jpeg = bytes(0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x64, 0x00, 0xc8, 0x00);
  assert.deepEqual(imageDimensions(jpeg), { width: 200, height: 100 });
  // SVG and video carry no raster header this parser understands.
  assert.equal(imageDimensions(new TextEncoder().encode('<svg></svg>')), null);
});

test('filenames keep only a display name', () => {
  assert.equal(cleanFilename('C:\\Users\\ravi\\hero image.png'), 'hero image.png');
  assert.equal(cleanFilename('/tmp/photos/charger.jpg'), 'charger.jpg');
  assert.equal(cleanFilename('  spaced.png  '), 'spaced.png');
  assert.equal(cleanFilename(''), 'upload');
  // Control characters are stripped, length is capped.
  assert.equal(cleanFilename('bad\u0000name.png'), 'badname.png');
  assert.equal(cleanFilename('a'.repeat(500)).length, 200);
});

test('alt text is optional, text, and capped at 300 characters', () => {
  assert.equal(altError(undefined), null);
  assert.equal(altError(''), null);
  assert.equal(altError('GaN charger, front view'), null);
  assert.match(altError(42), /text/);
  assert.match(altError('x'.repeat(301)), /300/);
});
