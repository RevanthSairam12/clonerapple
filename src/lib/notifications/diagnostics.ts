import nodemailer from 'nodemailer';

import type { StoreSettings } from '@/lib/store-admin/settings-rules';

import {
  deliverNotification,
  htmlToText,
  smtpOptions,
  type DeliveryResult,
} from './providers';
import { cleanPhone, normalizeEmail } from './rules';

/**
 * Real verification tools for outbound mail and SMS.
 *
 * Three things the settings screen could not tell an owner before:
 *   1. Can we reach the SMTP server and log in? (`checkMailConnection`, sends nothing)
 *   2. Does a real message arrive? (`sendTestEmail`, `sendTestSms`)
 *   3. What is still missing? (`configurationStatus`, names only)
 *
 * Every result is a fixed sentence chosen from a short list. A provider
 * response, host name, user name, password or stack trace is never copied
 * into a result: `classifySmtpFailure` reads only error *codes*.
 *
 * Pure of Next.js and the database so the script and the tests can use it.
 */

export type CheckCode =
  | 'ok'
  | 'not_configured'
  | 'bad_credentials'
  | 'connection_refused'
  | 'timeout'
  | 'tls_problem'
  | 'dns_failure'
  | 'recipient_rejected'
  | 'rejected'
  | 'dlt_required'
  | 'provider_error'
  | 'invalid_recipient'
  | 'unknown';

export interface CheckResult {
  ok: boolean;
  code: CheckCode;
  /** Plain words for the owner. Never contains a secret. */
  message: string;
}

const MESSAGES: Readonly<Record<CheckCode, string>> = {
  ok: 'It worked.',
  not_configured: 'Not configured.',
  bad_credentials: 'The mail server refused the login. Check the SMTP username and the MAIL_PASSWORD value.',
  connection_refused: 'Connection refused. Check the SMTP host and port, and that the server accepts connections from this machine.',
  timeout: 'The mail server did not answer in time. Check the host and port, or a firewall in between.',
  tls_problem: 'The secure connection could not be set up. Check the encryption choice: port 465 normally needs SSL, port 587 normally needs STARTTLS.',
  dns_failure: 'The SMTP host name could not be found. Check the spelling of the host.',
  recipient_rejected: 'The mail server rejected the recipient address.',
  rejected: 'The mail server rejected the message.',
  dlt_required: 'MSG91 needs an India DLT template id before it can deliver. Register a template on the DLT portal, then paste its id in the MSG91 DLT template id setting.',
  provider_error: 'The SMS provider did not accept the message.',
  invalid_recipient: 'That recipient looks invalid.',
  unknown: 'The check failed for an unrecognised reason. Nothing was sent.',
};

function result(code: CheckCode, message?: string): CheckResult {
  return { ok: code === 'ok', code, message: message ?? MESSAGES[code] };
}

function codeOf(error: unknown, field: 'code' | 'originalCode'): string {
  if (error && typeof error === 'object' && field in error) {
    return String((error as Record<string, unknown>)[field] ?? '');
  }
  return '';
}

function responseCodeOf(error: unknown): number | null {
  if (error && typeof error === 'object' && 'responseCode' in error) {
    const value = Number((error as { responseCode?: unknown }).responseCode);
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

const TLS_ORIGINAL_CODES = new Set([
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'SELF_SIGNED_CERT_IN_CHAIN',
]);

const REFUSED_ORIGINAL_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

/** Map a nodemailer error to a safe category. Reads codes only, never the message. */
export function classifySmtpFailure(error: unknown): CheckCode {
  const code = codeOf(error, 'code');
  const original = codeOf(error, 'originalCode');
  const responseCode = responseCodeOf(error);

  if (code === 'EAUTH' || responseCode === 535 || responseCode === 534) return 'bad_credentials';
  if (code === 'ETLS' || original.startsWith('ERR_SSL') || TLS_ORIGINAL_CODES.has(original)) {
    return 'tls_problem';
  }
  if (code === 'ETIMEDOUT' || original === 'ETIMEDOUT') return 'timeout';
  if (code === 'EDNS' || original === 'ENOTFOUND' || original === 'EAI_AGAIN') return 'dns_failure';
  if (REFUSED_ORIGINAL_CODES.has(original) || code === 'ECONNECTION' || code === 'ESOCKET') {
    return 'connection_refused';
  }
  if (code === 'EENVELOPE') return 'recipient_rejected';
  if (responseCode !== null && responseCode >= 500) return 'rejected';
  return 'unknown';
}

/* ------------------------------------------------------------ SMTP */

export interface MailTransportLike {
  verify(): Promise<unknown>;
  sendMail(message: Record<string, unknown>): Promise<unknown>;
  close(): void;
}

export interface MailDeps {
  env?: NodeJS.ProcessEnv;
  createTransport?: (options: ReturnType<typeof smtpOptions>) => MailTransportLike;
}

function defaultCreateTransport(options: ReturnType<typeof smtpOptions>): MailTransportLike {
  return nodemailer.createTransport(options) as unknown as MailTransportLike;
}

/**
 * What stops a connection check, ignoring the on/off switches: a check is how
 * an owner proves the details work *before* switching sending on.
 */
export function smtpSetupProblem(
  settings: StoreSettings,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (!settings.mail_host.trim()) return 'SMTP host is missing.';
  const port = Number(settings.mail_port);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return 'SMTP port is invalid.';
  if (settings.mail_username.trim() && !env.MAIL_PASSWORD?.trim()) {
    return 'MAIL_PASSWORD is not set in the environment.';
  }
  return null;
}

/** Connect, negotiate encryption and log in. Sends nothing. */
export async function checkMailConnection(
  settings: StoreSettings,
  deps: MailDeps = {},
): Promise<CheckResult> {
  const env = deps.env ?? process.env;
  const problem = smtpSetupProblem(settings, env);
  if (problem) return result('not_configured', `Not configured. ${problem}`);

  const transport = (deps.createTransport ?? defaultCreateTransport)(smtpOptions(settings, env));
  try {
    await transport.verify();
    return result('ok', 'Connected and logged in. The mail server accepted the connection. No email was sent.');
  } catch (error) {
    return result(classifySmtpFailure(error));
  } finally {
    transport.close();
  }
}

export const TEST_EMAIL_SUBJECT = '[TEST] Email check from your store';

/** Send one clearly labelled test email to an address the owner typed. */
export async function sendTestEmail(
  settings: StoreSettings,
  to: string,
  deps: MailDeps = {},
): Promise<CheckResult> {
  const env = deps.env ?? process.env;
  const recipient = normalizeEmail(to);
  if (!recipient) return result('invalid_recipient', 'That email address looks invalid.');

  const fromEmail = normalizeEmail(settings.mail_from_email);
  if (!fromEmail) return result('not_configured', 'Not configured. The From email is missing or invalid.');
  const problem = smtpSetupProblem(settings, env);
  if (problem) return result('not_configured', `Not configured. ${problem}`);

  const store = (settings.trade_name.trim() || 'your store').replace(/[<>&"']/g, '');
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif">
<h2>This is a test email</h2>
<p>This message was sent from the Store Admin “Send test email” button for ${store}.
If you can read this, your mail settings work. No customer was contacted and no order is involved.</p>
</body></html>`;

  const transport = (deps.createTransport ?? defaultCreateTransport)(smtpOptions(settings, env));
  try {
    const fromName = settings.mail_from_name.replace(/[\r\n]+/g, ' ').trim();
    await transport.sendMail({
      from: fromName ? { name: fromName, address: fromEmail } : fromEmail,
      to: recipient,
      subject: TEST_EMAIL_SUBJECT,
      text: htmlToText(html),
      html,
    });
    return result('ok', 'Sent. The mail server accepted the test email. Check the inbox (and spam) of that address.');
  } catch (error) {
    return result(classifySmtpFailure(error));
  } finally {
    transport.close();
  }
}

/* ------------------------------------------------------------- SMS */

function smsReasonToCode(reason: string): CheckCode {
  if (reason.includes('DLT')) return 'dlt_required';
  if (reason.includes('not configured')) return 'not_configured';
  if (reason.includes('authentication')) return 'bad_credentials';
  if (reason.includes('invalid phone') || reason.includes('country code')) return 'invalid_recipient';
  if (reason.includes('request failed') || reason.includes('unavailable')) return 'connection_refused';
  return 'provider_error';
}

/** Send one test SMS through the configured gateway (credentials come from the environment). */
export async function sendTestSms(settings: StoreSettings, to: string): Promise<CheckResult> {
  const phone = cleanPhone(to);
  if (!phone || phone.replace(/\D/g, '').length < 8) {
    return result(
      'invalid_recipient',
      'That phone number looks invalid. Include the country code, for example +919876543210.',
    );
  }

  // A test proves the gateway works before sending is switched on, so the
  // on/off switch is not part of this check; every other requirement is.
  const forTest = { ...settings, sms_status: 'on' } as StoreSettings;
  const delivery: DeliveryResult = await deliverNotification(
    {
      channel: 'sms',
      recipient: phone,
      subject: '',
      body: `${settings.trade_name.trim() || 'Store'}: this is a test SMS from Store Admin.`,
    },
    forTest,
  );

  if (delivery.outcome === 'SENT') {
    const detail = settings.sms_gateway === 'msg91'
      ? ' MSG91 accepted it; delivery to an Indian number also depends on the text matching your DLT template.'
      : ' The gateway accepted it for delivery.';
    return result('ok', `Sent.${detail}`);
  }

  const code = smsReasonToCode(delivery.reason);
  if (code === 'not_configured') {
    const missing = delivery.reason.replace(/^sms not configured \(/, '').replace(/\)$/, '');
    return result(code, `Not configured: ${missing}.`);
  }
  return result(code);
}

/* ------------------------------------------------- configuration status */

export interface ConfigItem {
  /** An environment variable or a setting key. Never a value. */
  name: string;
  kind: 'env' | 'setting';
  present: boolean;
  /** What stops working without it. */
  neededFor: string;
}

function has(value: string | undefined): boolean {
  return Boolean(value && value.trim());
}

/** Which required variables and settings are present. Names only. */
export function configurationStatus(
  settings: StoreSettings,
  env: NodeJS.ProcessEnv = process.env,
): ConfigItem[] {
  const items: ConfigItem[] = [
    { name: 'mail_driver = smtp', kind: 'setting', present: settings.mail_driver === 'smtp', neededFor: 'Email' },
    { name: 'mail_status = on', kind: 'setting', present: settings.mail_status === 'on', neededFor: 'Email' },
    { name: 'mail_host', kind: 'setting', present: has(settings.mail_host), neededFor: 'Email' },
    { name: 'mail_from_email', kind: 'setting', present: Boolean(normalizeEmail(settings.mail_from_email)), neededFor: 'Email' },
    { name: 'MAIL_PASSWORD', kind: 'env', present: has(env.MAIL_PASSWORD), neededFor: 'Email' },
    { name: 'sms_status = on', kind: 'setting', present: settings.sms_status === 'on', neededFor: 'SMS' },
    {
      name: 'sms_gateway',
      kind: 'setting',
      present: settings.sms_gateway === 'msg91' || settings.sms_gateway === 'twilio',
      neededFor: 'SMS',
    },
    { name: 'sms_sender_id', kind: 'setting', present: has(settings.sms_sender_id), neededFor: 'SMS' },
  ];
  if (settings.sms_gateway === 'twilio') {
    items.push(
      { name: 'TWILIO_ACCOUNT_SID', kind: 'env', present: has(env.TWILIO_ACCOUNT_SID), neededFor: 'SMS (Twilio)' },
      { name: 'TWILIO_AUTH_TOKEN', kind: 'env', present: has(env.TWILIO_AUTH_TOKEN), neededFor: 'SMS (Twilio)' },
    );
  } else {
    items.push(
      { name: 'MSG91_AUTH_KEY', kind: 'env', present: has(env.MSG91_AUTH_KEY), neededFor: 'SMS (MSG91)' },
      { name: 'sms_dlt_template_id', kind: 'setting', present: has(settings.sms_dlt_template_id), neededFor: 'SMS (MSG91, India DLT)' },
    );
  }
  items.push(
    { name: 'CRON_SECRET', kind: 'env', present: has(env.CRON_SECRET), neededFor: 'Retrying queued messages' },
    { name: 'APP_BASE_URL', kind: 'env', present: has(env.APP_BASE_URL), neededFor: 'Links inside emails' },
  );
  return items;
}
