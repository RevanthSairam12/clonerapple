/**
 * SECURITY (M-3): SVG was an accepted upload type. SVG is an active document
 * (script, foreignObject, external fetches), so a staff upload became stored
 * XSS when served from the storefront origin.
 *
 * New uploads reject it. Rows stored before the change still resolve, but as
 * a download with `default-src 'none'` rather than an inline document.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const jiti = createJiti(import.meta.url, {
  alias: { '@': path.join(root, 'src') },
});

const { ALLOWED_MEDIA_TYPES, MEDIA_EXTENSIONS, isAllowedMediaType, sniffMime } = await jiti.import(
  path.join(root, 'src', 'lib', 'store-admin', 'media-rules.ts'),
);

function bytes(text) {
  return new TextEncoder().encode(text);
}

test('SVG is not an accepted upload type', () => {
  assert.equal(isAllowedMediaType('image/svg+xml'), false);
  assert.equal((ALLOWED_MEDIA_TYPES).includes('image/svg+xml'), false);
  assert.equal(Object.values(MEDIA_EXTENSIONS).includes('svg'), false);

  assert.equal(sniffMime(bytes('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), null);
  assert.equal(sniffMime(bytes('<?xml version="1.0"?><svg></svg>')), null);
});

test('raster images and video still pass', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const png = new Uint8Array(8);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(sniffMime(jpeg), 'image/jpeg');
  assert.equal(sniffMime(png), 'image/png');
  assert.equal(isAllowedMediaType('image/webp'), true);
  assert.equal(isAllowedMediaType('video/mp4'), true);
});

test('legacy SVG rows are served as an attachment with a locked-down CSP', async () => {
  const source = await readFile(
    path.join(root, 'src', 'app', 'api', 'media', '[id]', 'route.ts'),
    'utf8',
  );
  assert.match(source, /isSvg/);
  assert.match(source, /'Content-Disposition': `attachment; filename="\$\{attachmentName\(row\.filename, id\)\}"`/);
  assert.match(source, /Content-Security-Policy': SVG_CSP/);
  assert.match(source, /const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:"/);
  assert.match(source, /'Content-Type': 'image\/svg\+xml'/);
  assert.match(source, /'X-Content-Type-Options': 'nosniff'/);
  // Non-SVG keeps the CDN redirect.
  assert.match(source, /status: 302/);
});
