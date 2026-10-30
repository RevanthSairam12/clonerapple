import test from 'node:test';
import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
import path from 'node:path';
const jiti = createJiti(import.meta.url, { alias: { '@': path.resolve('src') } });
const { validatePasswordChange } = await jiti.import('../src/lib/store-admin/password-rules.ts');
const valid = { currentPassword: 'temporary-value', newPassword: 'new-value-123', confirmPassword: 'new-value-123' };

test('staff password change shares exact plain-language validation', () => {
  assert.equal(validatePasswordChange(valid).ok, true);
  for (const [override, message] of [
    [{ newPassword: 'short' }, 'Password must be at least 8 characters'],
    [{ newPassword: 'a'.repeat(73) }, 'Password is too long'],
    [{ newPassword: '🙂'.repeat(19) }, 'Password is too long'],
    [{ confirmPassword: 'different' }, 'The two new passwords do not match'],
    [{ confirmPassword: undefined }, 'The two new passwords do not match'],
    [{ currentPassword: valid.newPassword }, 'New password must be different from the temporary password'],
    [{ currentPassword: '' }, 'Enter your current password.'],
  ]) assert.deepEqual(validatePasswordChange({ ...valid, ...override }), { ok: false, error: message });
});
