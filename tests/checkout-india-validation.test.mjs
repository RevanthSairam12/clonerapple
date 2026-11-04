import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url, { alias: { '@': path.resolve('src') } });
const { INDIAN_STATES, validateCheckoutContact, validateIndianAddress, normalizeIndianMobile, checkoutFieldErrors } = jiti('../src/lib/checkout/india-validation.ts');
const contact = { firstname: 'Ananya', email: 'person@example.test', phone: '9876543210' };
const address = { name: 'Ananya Rao', phone: contact.phone, line1: '12 Main Street', line2: '', city: 'Pune', state: 'Maharashtra', pincode: '411001' };
for (const phone of ['9876543210', '+91 98765-43210', '91 9876543210', '09876543210', ' 98765 43210 ']) {
  test(`Indian phone accepts supported format ${phone}`, () => {
    assert.equal(normalizeIndianMobile(phone), contact.phone);
    assert.equal(validateCheckoutContact({ ...contact, phone }).ok, true);
    assert.equal(validateIndianAddress({ ...address, phone }).value.phone, contact.phone);
  });
}
for (const phone of ['987654321', '98765432100', '5876543210', '+1 9876543210', '+91919876543210', '98765abc43210', 9876543210, null, {}, true]) {
  test(`Indian phone rejects ${JSON.stringify(phone)}`, () => {
    assert.equal(validateCheckoutContact({ ...contact, phone }).ok, false);
    assert.equal(validateIndianAddress({ ...address, phone }).ok, false);
  });
}
for (const field of ['firstname', 'email', 'phone']) for (const value of [null, {}, [], true, 12, '']) {
  test(`contact ${field} rejects malformed ${JSON.stringify(value)}`, () => assert.equal(validateCheckoutContact({ ...contact, [field]: value }).ok, false));
}
test('contact normalizes email and accepts names without destructive ASCII rewriting', () => {
  for (const firstname of ['Élodie', 'अनन्या', "O’Neil", 'Anne-Marie']) {
    const result = validateCheckoutContact({ ...contact, firstname, email: ' Person@Example.test ' });
    assert.equal(result.ok, true); assert.equal(result.value.firstname, firstname); assert.equal(result.value.email, 'person@example.test');
  }
  for (const firstname of ['A', 'x'.repeat(51), '<script>', 'John123', 'John\nRao']) assert.equal(validateCheckoutContact({ ...contact, firstname }).ok, false);
  for (const email of ['no-at', 'a@b', 'a @example.test', 'x'.repeat(255) + '@e.test']) assert.equal(validateCheckoutContact({ ...contact, email }).ok, false);
});
test('all 28 states and 8 union territories are accepted once', () => {
  assert.equal(INDIAN_STATES.length, 36); assert.equal(new Set(INDIAN_STATES).size, 36);
  for (const state of INDIAN_STATES) assert.equal(validateIndianAddress({ ...address, state }).value.state, state);
  assert.equal(validateIndianAddress({ ...address, state: 'Orissa' }).value.state, 'Odisha');
  assert.equal(validateIndianAddress({ ...address, state: 'New Delhi' }).value.state, 'Delhi');
  for (const state of ['', 'Unknown', 'CA', null, {}, 'x'.repeat(101)]) assert.equal(validateIndianAddress({ ...address, state }).ok, false);
});
for (const pincode of ['000000', '012345', '41100', '4110019', '41100A', 411001, null]) {
  test(`PIN rejects without truncating ${JSON.stringify(pincode)}`, () => assert.equal(validateIndianAddress({ ...address, pincode }).ok, false));
}
for (const field of ['name', 'line1', 'city', 'state', 'pincode']) {
  test(`address requires ${field}`, () => assert.equal(validateIndianAddress({ ...address, [field]: ' ' }).ok, false));
}
test('optional line2 accepts blank but rejects malformed or overlong input', () => {
  assert.equal(validateIndianAddress(address).ok, true);
  for (const line2 of ['x'.repeat(201), {}, 123]) assert.equal(validateIndianAddress({ ...address, line2 }).ok, false);
  for (const [field, length] of [['name', 101], ['line1', 201], ['city', 101]]) assert.equal(validateIndianAddress({ ...address, [field]: 'x'.repeat(length) }).ok, false);
});
test('unknown entire payloads return errors, never throw', () => {
  for (const value of [null, undefined, [], 1, true, 'text']) {
    assert.equal(validateIndianAddress(value).ok, false);
    assert.equal(validateCheckoutContact(value).ok, false);
  }
});
test('checkout errors focus contact first and never target a removed recipient input', () => {
  const errors = checkoutFieldErrors({}, {});
  assert.equal(Object.keys(errors)[0], 'firstname');
  assert.equal(errors.name, undefined);
  const legacyName = checkoutFieldErrors(contact, { ...address, name: '' });
  assert.ok(legacyName.firstname);
  assert.equal(legacyName.name, undefined);
});
test('client combined errors and account/server address adapter preserve identical messages', () => {
  const { validateAddressInput } = jiti('../src/lib/account/rules.ts');
  const invalid = { ...address, phone: '123', pincode: '000000', state: 'Mars' };
  assert.deepEqual(validateAddressInput(invalid), validateIndianAddress(invalid));
  const errors = checkoutFieldErrors({ ...contact, phone: '123' }, invalid);
  assert.equal(errors.phone, validateCheckoutContact({ ...contact, phone: '123' }).errors.phone);
  assert.equal(errors.pincode, validateIndianAddress(invalid).errors.pincode);
});
