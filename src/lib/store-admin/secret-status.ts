/**
 * Reports whether a secret is configured, never what it is.
 *
 * Gateway keys, SMTP passwords and reCAPTCHA secrets live in environment
 * variables. A settings screen may tell an operator that a value is missing so
 * they know where to look; it must never render or persist the value.
 */

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Secret status is a server-side check.');
}

export interface SecretStatus {
  label: string;
  envVar: string;
  present: boolean;
}

export function secretStatus(
  entries: readonly { label: string; envVar: string }[],
): SecretStatus[] {
  return entries.map((entry) => ({
    label: entry.label,
    envVar: entry.envVar,
    present: Boolean(process.env[entry.envVar]?.trim()),
  }));
}
