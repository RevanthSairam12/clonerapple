/**
 * SECURITY (L-3): sign-up answered 409 "An account with this email already
 * exists." for a registered address and 200 for a new one, so the form was an
 * account-enumeration oracle.
 *
 * Both cases now return `{ ok: true }`. Only a new account receives a session
 * token, and the existing-account path does the same password hashing work so
 * the timing does not distinguish them either. The client already treats
 * `res.ok` as success, so the flow is unchanged.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

test('the duplicate-account branch is a generic success with no token', async () => {
  const source = await readFile(path.join(root, 'src', 'lib', 'user-auth.ts'), 'utf8');

  assert.doesNotMatch(source, /An account with this email already exists/);
  assert.match(source, /if \(existing\.length > 0\) \{\s*await bcrypt\.hash\(password, BCRYPT_ROUNDS\);\s*return \{ ok: true, token: null \};/);
  assert.match(source, /token: string \| null/);
});

test('the route only sets a session cookie when a token exists', async () => {
  const source = await readFile(
    path.join(root, 'src', 'app', 'api', 'auth', 'signup', 'route.ts'),
    'utf8',
  );
  assert.match(source, /if \(result\.token\) \{/);
  assert.match(source, /store\.set\(userSessionCookie\.name, result\.token/);
  assert.match(source, /return NextResponse\.json\(\{ ok: true \}\)/);
});

test('the sign-up form still treats a 200 as success', async () => {
  const source = await readFile(
    path.join(root, 'src', 'components', 'auth', 'AuthForm.tsx'),
    'utf8',
  );
  assert.match(source, /if \(res\.ok\)/);
  assert.match(source, /window\.location\.href = targetUrl/);
});
