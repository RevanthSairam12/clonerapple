/**
 * Store pickup does not exist. The setting cannot be turned on, nothing on the
 * server reads it, and no storefront copy offers it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const jiti = createJiti(import.meta.url, { alias: { '@': path.join(root, 'src') } });
const rules = await jiti.import(path.join(root, 'src', 'lib', 'store-admin', 'settings-rules.ts'));

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}
const rel = (file) => path.relative(root, file).replace(/\\/g, '/');

test('the default is off', () => {
  assert.equal(rules.DEFAULT_SETTINGS.pickup_enabled, 'off');
});

test('the setting cannot be saved as on, by any spelling', () => {
  for (const value of ['on', 'ON', true, 'true', '1', 1, ' on ']) {
    const result = rules.validateSettingValue('pickup_enabled', value);
    assert.equal(result.ok, false, `${String(value)} must be refused`);
    assert.match(result.error, /not available yet/);
  }
  const off = rules.validateSettingValue('pickup_enabled', 'off');
  assert.equal(off.ok, true);
  assert.equal(off.value, 'off');
});

test('the control is locked, so the screen renders it disabled', () => {
  const field = rules.SETTING_FIELDS.find((f) => f.key === 'pickup_enabled');
  assert.equal(field.locked, true);
  assert.equal(field.lockedValue, 'off');
  assert.match(field.help, /Store pickup is not available yet/);
});

test('a stored "on" can never become pickup behaviour', () => {
  assert.equal(rules.pickupEnabled(), false);
  assert.equal(rules.pickupEnabled({ pickup_enabled: 'on' }), false);
});

test('no server code reads the pickup setting', () => {
  const allowed = new Set(['src/lib/store-admin/settings-rules.ts']);
  const offenders = walk(path.join(root, 'src'))
    .map(rel)
    .filter((file) => !allowed.has(file))
    .filter((file) => /pickup_enabled/.test(readFileSync(path.join(root, file), 'utf8')));
  assert.deepEqual(offenders, [], 'only settings-rules.ts may name pickup_enabled');
});

test('no storefront, template, receipt or admin copy offers pickup', () => {
  const offenders = [];
  for (const file of walk(path.join(root, 'src')).map(rel)) {
    if (file === 'src/lib/store-admin/settings-rules.ts') continue;
    const text = readFileSync(path.join(root, file), 'utf8');
    // "pick up where you left off" is the Saved Items sentence, not a pickup offer.
    const stripped = text.replace(/pick up right where you left off/g, '');
    if (/store pickup|pickup:|showPickup|pick up your order|experience cent(er|re)|click (&|and) collect/i.test(stripped)) {
      offenders.push(file);
    }
  }
  assert.deepEqual(offenders, []);
});

test('the data-fix migration forces the value off and audits it', () => {
  const sql = readFileSync(path.join(root, 'migrations', '0042_pickup_off.sql'), 'utf8');
  assert.match(sql, /'pickup_enabled', 'off'/);
  assert.match(sql, /insert into store_admin_audit/);
  assert.doesNotMatch(sql, /create table/i);
});
