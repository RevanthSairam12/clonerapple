/**
 * Pure notification rules: recipient cleanup, dedupe keys and retry delay.
 *
 * Keeping these free of database and environment access makes the edge cases
 * (two callbacks, a phone with spaces, a token containing a colon) testable
 * without a schema.
 */

import type { NotificationAudience, NotificationChannel } from './types';

/** After this many failed sends the row stays FAILED for an admin to inspect. */
export const MAX_NOTIFICATION_ATTEMPTS = 5;

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Sending form of an email: trimmed and lower-cased. Empty when unusable. */
export function normalizeEmail(value: unknown): string {
  const email = String(value ?? '').replace(CONTROL_CHARS, '').trim().toLowerCase();
  if (!email || email.length > 320) return '';
  // A deliberately loose shape check; the provider is the final authority.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '';
  return email;
}

/** Sending form of a phone number: keep a leading + and digits only. */
export function cleanPhone(value: unknown): string {
  const raw = String(value ?? '').replace(CONTROL_CHARS, '').trim();
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length > 15) return '';
  return raw.startsWith('+') ? `+${digits}` : digits;
}

/** Dedupe/compare form of a phone number: digits only. */
export function normalizePhone(value: unknown): string {
  return cleanPhone(value).replace(/\D/g, '');
}

/**
 * One message per event, entity, channel, audience and recipient. `token`
 * separates legitimate repeats (a second return request); events that must
 * fire once leave it unset and therefore share the `once` suffix.
 */
export function dedupeKey(input: {
  event: string;
  entityType: string;
  entityId: string;
  channel: NotificationChannel;
  audience: NotificationAudience;
  recipient: string;
  token?: string | null;
}): string {
  const recipient = input.channel === 'email'
    ? normalizeEmail(input.recipient)
    : input.channel === 'sms'
      ? normalizePhone(input.recipient)
      : input.recipient || input.audience;
  const token = String(input.token ?? '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'once';
  return [
    input.event,
    input.entityType,
    input.entityId,
    input.channel,
    input.audience,
    recipient || 'missing',
    token,
  ].join(':');
}

/** 60s, 120s, 240s, 480s … capped at an hour. */
export function retryDelaySeconds(attempts: number): number {
  const safe = Number.isFinite(attempts) ? Math.max(1, Math.floor(attempts)) : 1;
  return Math.min(3600, 60 * 2 ** (safe - 1));
}

/** Retention is opt-in; when enabled without a number, keep 90 days. */
export const DEFAULT_NOTIFICATION_RETENTION_DAYS = 90;

/**
 * Read the optional retention window.
 *
 * `NOTIFICATION_RETENTION_ENABLED` is the switch; without it nothing is ever
 * scrubbed. `NOTIFICATION_RETENTION_DAYS` defaults to 90 and is clamped to a
 * sane range so a typo cannot clear today's messages.
 */
export function notificationRetentionDays(
  env: Readonly<Record<string, string | undefined>>,
): number | null {
  const enabled = String(env.NOTIFICATION_RETENTION_ENABLED ?? '').trim().toLowerCase();
  if (!['1', 'true', 'on', 'yes'].includes(enabled)) return null;
  const raw = Number(String(env.NOTIFICATION_RETENTION_DAYS ?? '').trim());
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_NOTIFICATION_RETENTION_DAYS;
  return Math.min(Math.trunc(raw), 3650);
}

/** The oldest row a retention run may scrub. */
export function retentionCutoff(days: number, now: Date = new Date()): Date {
  const safe = Number.isFinite(days)
    ? Math.max(1, Math.trunc(days))
    : DEFAULT_NOTIFICATION_RETENTION_DAYS;
  return new Date(now.getTime() - safe * 86_400_000);
}

/** Deduplicate cleaned recipients while preserving their sending form. */
export function uniqueRecipients(
  rawValues: readonly unknown[],
  channel: 'email' | 'sms',
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of rawValues) {
    const cleaned = channel === 'email' ? normalizeEmail(raw) : cleanPhone(raw);
    if (!cleaned) continue;
    const key = channel === 'email' ? cleaned : normalizePhone(cleaned);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}
