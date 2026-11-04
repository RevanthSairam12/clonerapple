import { createHash } from 'node:crypto';
import { validateIndianAddress } from '@/lib/checkout/india-validation';

export interface AddressInput {
  name?: unknown;
  phone?: unknown;
  line1?: unknown;
  line2?: unknown;
  city?: unknown;
  state?: unknown;
  pincode?: unknown;
}

export interface ValidatedAddress {
  name: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  pincode: string;
}

export function validateAddressInput(input: unknown) {
  return validateIndianAddress(input);
}

export function maskAccountEmail(value: string): string {
  const [local, domain] = value.trim().split('@');
  if (!local || !domain) return '[redacted email]';
  return `${local.slice(0, 1)}***@${domain}`;
}

export function maskAccountPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 10) return '**********';
  return `${digits.slice(0, 2)}******${digits.slice(-2)}`;
}

export function isOwnedBySession(sessionUserId: string, ownerUserId: string | null | undefined): boolean {
  return Boolean(sessionUserId && ownerUserId && sessionUserId === ownerUserId);
}

export function isWithinReturnWindow(deliveredAt: Date | string | null | undefined, now = new Date(), days = 7): boolean {
  if (!deliveredAt) return false;
  const delivered = deliveredAt instanceof Date ? deliveredAt : new Date(deliveredAt);
  if (!Number.isFinite(delivered.getTime())) return false;
  const age = now.getTime() - delivered.getTime();
  return age >= 0 && age <= days * 24 * 60 * 60 * 1000;
}

export function hashAuditValue(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}
