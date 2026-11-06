/**
 * SECURITY (L-8): archiving a media row only set `deleted_at`. The object stayed
 * in the public `media` bucket at an immutable CDN URL, so anyone holding the
 * link could still fetch "archived" media.
 *
 * The object is now deleted after the archive commits. The delete is
 * best-effort: a Storage outage must not fail the staff action, and the failure
 * is logged without the object path or URL.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

// The storage helper reads its configuration at import, so set a throwaway
// endpoint before loading it. Nothing here is a real credential.
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://storage.example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';

const jiti = createJiti(import.meta.url, {
  alias: { '@': path.join(root, 'src') },
});

const { deleteFromStorage } = await jiti.import(
  path.join(root, 'src', 'lib', 'platform', 'storage.ts'),
);

test('the delete calls the Storage object API with the service role', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return { ok: true };
  };
  try {
    assert.equal(await deleteFromStorage('abc-123.png'), true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.method, 'DELETE');
    assert.match(calls[0].url, /\/storage\/v1\/object\/media\/abc-123\.png$/);
    assert.equal(calls[0].init.headers.authorization, 'Bearer test-only');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a failed or impossible delete returns false instead of throwing', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 500 });
  try {
    assert.equal(await deleteFromStorage('abc-123.png'), false);
    assert.equal(await deleteFromStorage(''), false);
    assert.equal(await deleteFromStorage('   '), false);

    globalThis.fetch = async () => {
      throw new Error('network down');
    };
    assert.equal(await deleteFromStorage('abc-123.png'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('archiveMedia removes the object only after the archive committed', async () => {
  const source = await readFile(path.join(root, 'src', 'lib', 'store-admin', 'media.ts'), 'utf8');

  assert.match(source, /import \{ deleteFromStorage \} from '@\/lib\/platform\/storage';/);
  assert.match(source, /result = await sql\.begin\(/);
  // The delete sits after the try/catch that wraps the transaction, guarded on success.
  const bodyStart = source.indexOf('export async function archiveMedia');
  assert.ok(bodyStart > 0);
  const body = source.slice(bodyStart);
  const txEnd = body.indexOf("could not archive media");
  const deleteAt = body.indexOf('await deleteFromStorage(storagePath)');
  assert.ok(deleteAt > txEnd, 'storage delete must follow the committed transaction');
  assert.match(body, /if \(result\.ok\) \{/);
  assert.match(body, /console\.warn\('\[store-admin\/media\] archived row still has its storage object'\)/);
});
