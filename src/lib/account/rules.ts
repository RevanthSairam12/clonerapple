import { createHash } from 'node:crypto';

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

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function validateAddressInput(input: AddressInput):
  | { ok: true; value: ValidatedAddress }
  | { ok: false; error: string } {
  const value: ValidatedAddress = {
    name: text(input.name, 100),
    phone: text(input.phone, 20).replace(/\D/g, ''),
    line1: text(input.line1, 200),
    line2: text(input.line2, 200),
    city: text(input.city, 100),
    state: text(input.state, 100),
    pincode: text(input.pincode, 6),
  };
  if (value.name.length < 2) return { ok: false, error: 'A full name is required.' };
  if (!/^\d{10}$/.test(value.phone)) return { ok: false, error: 'Phone must contain 10 digits.' };
  if (!value.line1) return { ok: false, error: 'Address line 1 is required.' };
  if (!value.city) return { ok: false, error: 'City is required.' };
  if (!value.state) return { ok: false, error: 'State is required.' };
  if (!/^\d{6}$/.test(value.pincode)) return { ok: false, error: 'Pincode must contain 6 digits.' };
  return { ok: true, value };
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
