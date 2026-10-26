import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SETTINGS,
  SETTING_FIELDS,
  SETTING_KEYS,
  SETTING_SECTIONS,
  fieldsForSection,
  isOwnerOnlySetting,
  isStoreSettingKey,
  normalizeToggle,
  validateSettingValue,
} from '../src/lib/store-admin/settings-rules.ts';

test('every field has a default and a unique key', () => {
  assert.equal(new Set(SETTING_KEYS).size, SETTING_KEYS.length);
  for (const field of SETTING_FIELDS) {
    assert.equal(typeof DEFAULT_SETTINGS[field.key], 'string', field.key);
    assert.equal(isStoreSettingKey(field.key), true, field.key);
  }
});

test('every section owns at least one field', () => {
  for (const section of SETTING_SECTIONS) {
    assert.ok(fieldsForSection(section.key).length > 0, section.key);
    for (const field of fieldsForSection(section.key)) {
      assert.equal(field.section, section.key);
    }
  }
});

test('toggles normalize to on or off', () => {
  assert.equal(normalizeToggle(true), 'on');
  assert.equal(normalizeToggle('YES'), 'on');
  assert.equal(normalizeToggle(1), 'on');
  assert.equal(normalizeToggle(false), 'off');
  assert.equal(normalizeToggle('nonsense'), 'off');
  assert.equal(normalizeToggle(undefined), 'off');
});

test('emails are validated only when non-empty', () => {
  assert.deepEqual(validateSettingValue('email', ''), { ok: true, value: '' });
  assert.deepEqual(validateSettingValue('email', 'desk@gadzio.test'), {
    ok: true,
    value: 'desk@gadzio.test',
  });
  assert.equal(validateSettingValue('email', 'not-an-email').ok, false);
});

test('selects reject values outside their options', () => {
  assert.equal(validateSettingValue('timezone', 'Mars/Olympus').ok, false);
  assert.equal(validateSettingValue('timezone', 'Asia/Kolkata').ok, true);
  assert.equal(validateSettingValue('mail_driver', 'sendmail').ok, false);
});

test('numbers are whole, non-negative and default to zero', () => {
  assert.deepEqual(validateSettingValue('mail_port', ''), { ok: true, value: '0' });
  assert.equal(validateSettingValue('mail_port', '587').ok, true);
  assert.equal(validateSettingValue('mail_port', '-1').ok, false);
  assert.equal(validateSettingValue('mail_port', '5.87').ok, false);
});

test('text fields enforce their length limit', () => {
  const result = validateSettingValue('order_prefix', 'X'.repeat(40));
  assert.equal(result.ok, false);
});

test('datetime fields accept an empty value or datetime-local text', () => {
  assert.deepEqual(validateSettingValue('maintenance_starts_at', ''), { ok: true, value: '' });
  assert.equal(validateSettingValue('maintenance_starts_at', '2026-10-25T18:30').ok, true);
  assert.equal(validateSettingValue('maintenance_starts_at', '2026-10-25').ok, false);
});

test('unknown keys are refused', () => {
  assert.equal(validateSettingValue('not_a_setting', 'x').ok, false);
  assert.equal(isStoreSettingKey('not_a_setting'), false);
});

test('maintenance is the only owner-only group', () => {
  for (const field of SETTING_FIELDS) {
    assert.equal(
      isOwnerOnlySetting(field.key),
      field.key.startsWith('maintenance_'),
      field.key,
    );
  }
});
