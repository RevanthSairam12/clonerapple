/**
 * SECURITY (I-5): the media upload route called `request.formData()` first and
 * only then checked the file size. Next buffers the whole multipart body before
 * that call returns, so a large upload was held in memory before the 25 MB rule
 * could reject it.
 *
 * The route now refuses a declared oversized body by Content-Length before
 * buffering. The declared length is advisory, so the post-parse size check
 * stays as the authoritative gate.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

test('the declared length is checked before the multipart body is buffered', async () => {
  const source = await readFile(
    path.join(root, 'src', 'app', 'api', 'store-admin', 'media', 'route.ts'),
    'utf8',
  );

  const lengthCheck = source.indexOf("request.headers.get('content-length')");
  const formData = source.indexOf('await request.formData()');
  assert.ok(lengthCheck > 0, 'the route must read Content-Length');
  assert.ok(formData > 0, 'the route still parses multipart');
  assert.ok(lengthCheck < formData, 'the header check must come first');

  // A declared length above the file limit plus multipart overhead is a 413
  // before any buffering, with the same message a post-parse oversize gets.
  const guard = source.slice(lengthCheck, formData);
  assert.match(guard, /declaredLength > MAX_MEDIA_BYTES \+ MULTIPART_OVERHEAD_BYTES/);
  assert.match(guard, /status: 413/);
  assert.match(guard, /Files must be 25 MB or smaller\./);
});

test('the post-parse size check remains the authoritative gate', async () => {
  const source = await readFile(
    path.join(root, 'src', 'app', 'api', 'store-admin', 'media', 'route.ts'),
    'utf8',
  );
  const formData = source.indexOf('await request.formData()');
  const after = source.slice(formData);
  assert.match(after, /if \(file\.size > MAX_MEDIA_BYTES\)/);
  assert.match(after, /status: 413/);
});
