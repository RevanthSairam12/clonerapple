/**
 * SECURITY (M-1): the customer detail endpoint was readable by every signed-in
 * store role and returned saved street addresses and postal codes unmasked.
 *
 * The detail is now admin-and-above, street lines and postal codes are masked
 * for everyone, and the owner-only reveal handles a single address only when
 * it belongs to that customer.
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

const { maskCustomerAddressPart } = await jiti.import(
  path.join(root, 'src', 'lib', 'store-admin', 'masking.ts'),
);

test('an address line or postal code is hidden whenever it has a value', () => {
  assert.equal(maskCustomerAddressPart('12 Main Street'), '[redacted]');
  assert.equal(maskCustomerAddressPart('560001'), '[redacted]');
  assert.equal(maskCustomerAddressPart('  '), '');
  assert.equal(maskCustomerAddressPart(undefined), '');
});

test('the customer detail is admin-and-above', async () => {
  const source = await readFile(
    path.join(root, 'src', 'app', 'api', 'store-admin', 'customers', '[id]', 'route.ts'),
    'utf8',
  );
  assert.match(source, /requireStoreRole\('store_admin'\)/);
  assert.doesNotMatch(source, /requireStoreRole\(\)/);
});

test('the detail masks street lines, postal code and phone', async () => {
  const source = await readFile(
    path.join(root, 'src', 'lib', 'store-admin', 'customers.ts'),
    'utf8',
  );
  assert.match(source, /line1: maskCustomerAddressPart\(text\(row\.line1\)\)/);
  assert.match(source, /line2: maskCustomerAddressPart\(text\(row\.line2\)\)/);
  assert.match(source, /pincode: maskCustomerAddressPart\(text\(row\.pincode\)\)/);
  assert.match(source, /phoneMasked: maskCustomerPhone\(text\(row\.phone\)\)/);
});

test('address reveal is owner-only, audited and scoped to the customer', async () => {
  const lib = await readFile(
    path.join(root, 'src', 'lib', 'store-admin', 'customers.ts'),
    'utf8',
  );
  assert.match(lib, /field === 'address'/);
  assert.match(lib, /where id = \$\{address\} and user_id = \$\{customerId\} and deleted_at is null/);

  const route = await readFile(
    path.join(root, 'src', 'app', 'api', 'store-admin', 'customers', '[id]', 'reveal', 'route.ts'),
    'utf8',
  );
  assert.match(route, /requireStoreRole\('store_owner'\)/);
  assert.match(route, /assertSameOrigin\(request\)/);
  assert.match(route, /field === 'address' && \(!addressId/);
  assert.match(route, /revealCustomerField\(id, field, addressId\)/);
  assert.match(route, /action: 'customer\.reveal'/);
  assert.match(route, /after: \{ field, \.\.\.\(addressId \? \{ addressId \} : \{\}\) \}/);
});
