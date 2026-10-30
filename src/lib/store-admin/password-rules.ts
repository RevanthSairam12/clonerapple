import { passwordByteLength } from '@/lib/auth/validation';

/** Shared by both staff password forms and the server; never trims credentials. */
export function validatePasswordChange(input: {
  currentPassword?: unknown;
  newPassword?: unknown;
  confirmPassword?: unknown;
}): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof input.newPassword !== 'string' || input.newPassword.length < 8) {
    return { ok: false, error: 'Password must be at least 8 characters' };
  }
  if (passwordByteLength(input.newPassword) > 72) {
    return { ok: false, error: 'Password is too long' };
  }
  if (input.newPassword !== input.confirmPassword) {
    return { ok: false, error: 'The two new passwords do not match' };
  }
  if (typeof input.currentPassword !== 'string' || !input.currentPassword) {
    return { ok: false, error: 'Enter your current password.' };
  }
  if (input.currentPassword === input.newPassword) {
    return { ok: false, error: 'New password must be different from the temporary password' };
  }
  return { ok: true, value: input.newPassword };
}
