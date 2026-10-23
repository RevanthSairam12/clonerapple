import test from 'node:test';
import assert from 'node:assert/strict';

import { safeRedirectPath } from '../src/lib/auth/redirect.ts';
import {
  isValidEmail,
  normalizeEmail,
  normalizeName,
  passwordByteLength,
  validatePassword,
} from '../src/lib/auth/validation.ts';
import {
  maskCustomerEmail,
  maskCustomerPhone,
} from '../src/lib/store-admin/masking.ts';

/* ------------------------------------------------------- redirects */

test('redirect: allows same-origin relative paths', () => {
  assert.equal(safeRedirectPath('/checkout'), '/checkout');
  assert.equal(
    safeRedirectPath('/checkout?productId=abc&qty=2'),
    '/checkout?productId=abc&qty=2',
  );
  assert.equal(safeRedirectPath('/checkout#pay'), '/checkout#pay');
  assert.equal(safeRedirectPath('/'), '/');
});

test('redirect: trims surrounding whitespace before checking', () => {
  assert.equal(safeRedirectPath('  /checkout  '), '/checkout');
});

test('redirect: rejects absolute URLs and schemes', () => {
  assert.equal(safeRedirectPath('https://evil.example'), '/');
  assert.equal(safeRedirectPath('http://evil.example/path'), '/');
  assert.equal(safeRedirectPath('javascript:alert(1)'), '/');
  assert.equal(safeRedirectPath('data:text/html,hi'), '/');
});

test('redirect: rejects protocol-relative and backslash forms', () => {
  assert.equal(safeRedirectPath('//evil.example'), '/');
  assert.equal(safeRedirectPath('///evil.example'), '/');
  assert.equal(safeRedirectPath('/' + String.fromCharCode(92) + 'evil.example'), '/');
  assert.equal(safeRedirectPath('/a/' + String.fromCharCode(92) + 'b'), '/');
});

test('redirect: rejects control characters and relative names', () => {
  assert.equal(safeRedirectPath('/\t/evil.example'), '/');
  assert.equal(safeRedirectPath('/\u0000evil'), '/');
  assert.equal(safeRedirectPath('checkout'), '/');
});

test('redirect: rejects non-strings, blanks and over-long values', () => {
  assert.equal(safeRedirectPath(null), '/');
  assert.equal(safeRedirectPath(undefined), '/');
  assert.equal(safeRedirectPath({ href: '/checkout' }), '/');
  assert.equal(safeRedirectPath(''), '/');
  assert.equal(safeRedirectPath('/' + 'a'.repeat(3000)), '/');
});

test('redirect: uses the supplied fallback', () => {
  assert.equal(safeRedirectPath('https://evil.example', '/cart'), '/cart');
  assert.equal(safeRedirectPath(undefined, '/bag'), '/bag');
});

/* ------------------------------------------------------- validation */

test('email: normalized to trimmed lowercase', () => {
  assert.equal(normalizeEmail('  Foo.Bar@Example.COM '), 'foo.bar@example.com');
  assert.equal(normalizeEmail(undefined), '');
  assert.equal(normalizeEmail(42), '');
});

test('email: format validation', () => {
  assert.equal(isValidEmail('a@b.co'), true);
  assert.equal(isValidEmail('first.last+tag@example.com'), true);
  assert.equal(isValidEmail('no-at-sign.example'), false);
  assert.equal(isValidEmail('two@@example.com'), false);
  assert.equal(isValidEmail('spaces in@example.com'), false);
  assert.equal(isValidEmail('missing-domain@'), false);
  assert.equal(isValidEmail(''), false);
  assert.equal(isValidEmail('a@b'), false);
  assert.equal(isValidEmail('x'.repeat(250) + '@a.co'), false);
});

test('name: trimmed and capped', () => {
  assert.equal(normalizeName('  Ravi  '), 'Ravi');
  assert.equal(normalizeName(null), '');
  assert.equal(normalizeName('x'.repeat(150)).length, 100);
});

test('password: minimum 8 characters', () => {
  assert.equal(validatePassword('1234567').ok, false);
  assert.equal(validatePassword('12345678').ok, true);
  assert.equal(validatePassword(undefined).ok, false);
  assert.equal(validatePassword(12345678).ok, false);
});

test('password: maximum 72 UTF-8 bytes', () => {
  assert.equal(passwordByteLength('abc'), 3);
  assert.equal(passwordByteLength('é'), 2);
  assert.equal(validatePassword('a'.repeat(72)).ok, true);
  assert.equal(validatePassword('a'.repeat(73)).ok, false);
  // 36 × "é" = 72 bytes; 37 × "é" = 74 bytes.
  assert.equal(validatePassword('é'.repeat(36)).ok, true);
  assert.equal(validatePassword('é'.repeat(37)).ok, false);
});

/* ---------------------------------------------------------- masking */

test('masking: email keeps only the first local character', () => {
  assert.equal(maskCustomerEmail('ravi@example.com'), 'r***@example.com');
  assert.equal(maskCustomerEmail('  Ravi.Kumar@Example.com '), 'R***@Example.com');
  assert.equal(maskCustomerEmail('@example.com'), '[redacted email]');
  assert.equal(maskCustomerEmail('ravi@'), '[redacted email]');
  assert.equal(maskCustomerEmail(''), '[redacted email]');
  assert.equal(maskCustomerEmail(null), '[redacted email]');
});

test('masking: phone keeps the first and last two digits', () => {
  assert.equal(maskCustomerPhone('9876543210'), '98******10');
  assert.equal(maskCustomerPhone('+91 98765 43210'), '91********10');
  assert.equal(maskCustomerPhone('1234'), '****');
  assert.equal(maskCustomerPhone(''), '[redacted phone]');
  assert.equal(maskCustomerPhone(undefined), '[redacted phone]');
});

test('masking: never returns more than four visible digits', () => {
  for (const phone of ['9876543210', '+91 98765 43210', '123456789012345']) {
    const masked = maskCustomerPhone(phone);
    const visible = masked.replace(/\*/g, '').replace(/\D/g, '');
    assert.ok(visible.length <= 4, `too many visible digits in ${masked}`);
  }
});
