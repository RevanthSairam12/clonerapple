import nodemailer from 'nodemailer';

import type { StoreSettings } from '@/lib/store-admin/settings-rules';

import { cleanPhone, normalizeEmail } from './rules';

/**
 * Provider clients for the outbox worker.
 *
 * Email uses SMTP through nodemailer because a hand-written SMTP client would
 * be a lot of untested protocol code. SMS uses plain fetch for MSG91 and
 * Twilio so no SDK is needed.
 *
 * Every returned reason is a fixed, human-readable sentence. Provider
 * responses, host names, usernames and secrets never enter a reason, a log
 * line or the outbox row. A 10s timeout bounds every network call.
 */

export const PROVIDER_TIMEOUT_MS = 10_000;

export interface DeliveryInput {
  channel: 'email' | 'sms';
  recipient: string;
  subject: string;
  body: string;
}

export interface DeliveryResult {
  outcome: 'SENT' | 'SKIPPED' | 'FAILED';
  reason: string;
  /** A bad recipient or bad credentials: retrying the same input cannot help. */
  permanent: boolean;
}

const SENT: DeliveryResult = { outcome: 'SENT', reason: '', permanent: false };

function skipped(reason: string): DeliveryResult {
  return { outcome: 'SKIPPED', reason, permanent: false };
}

function failed(reason: string, permanent: boolean): DeliveryResult {
  return { outcome: 'FAILED', reason, permanent };
}

/** Plain-text alternative for clients that do not render HTML. */
export function htmlToText(html: string): string {
  return String(html ?? '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h1|h2|h3)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** What is missing before SMTP can send. Never includes a value. */
export function mailConfigProblem(
  settings: StoreSettings,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (settings.mail_driver !== 'smtp') {
    return 'mail not configured (mail driver is not SMTP)';
  }
  if (settings.mail_status !== 'on') {
    return 'mail not configured (email sending is off)';
  }
  if (!settings.mail_host.trim()) {
    return 'mail not configured (SMTP host is missing)';
  }
  if (!settings.mail_from_email.trim()) {
    return 'mail not configured (From email is missing)';
  }
  if (!normalizeEmail(settings.mail_from_email)) {
    return 'mail not configured (From email is invalid)';
  }
  if (!env.MAIL_PASSWORD?.trim()) {
    return 'mail not configured (MAIL_PASSWORD is missing)';
  }
  const port = Number(settings.mail_port);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return 'mail not configured (SMTP port is invalid)';
  }
  return null;
}

/** What is missing before an SMS gateway can send. Never includes a value. */
export function smsConfigProblem(
  settings: StoreSettings,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (settings.sms_status !== 'on') {
    return 'sms not configured (SMS sending is off)';
  }
  if (settings.sms_gateway === 'none' || !settings.sms_gateway) {
    return 'sms not configured (no gateway chosen)';
  }
  if (!settings.sms_sender_id.trim()) {
    return 'sms not configured (sender id is missing)';
  }
  if (settings.sms_gateway === 'msg91' && !env.MSG91_AUTH_KEY?.trim()) {
    return 'sms not configured (MSG91_AUTH_KEY is missing)';
  }
  // Indian carriers silently drop SMS that do not match a DLT-registered
  // template, and MSG91 still answers 200. Refuse to claim a send is possible.
  if (settings.sms_gateway === 'msg91' && !settings.sms_dlt_template_id.trim()) {
    return 'sms not configured (MSG91 needs an India DLT template id)';
  }
  if (settings.sms_gateway === 'twilio') {
    if (!env.TWILIO_ACCOUNT_SID?.trim()) {
      return 'sms not configured (TWILIO_ACCOUNT_SID is missing)';
    }
    if (!env.TWILIO_AUTH_TOKEN?.trim()) {
      return 'sms not configured (TWILIO_AUTH_TOKEN is missing)';
    }
  }
  return null;
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    return String((error as { code?: unknown }).code ?? '');
  }
  return '';
}

function errorResponseCode(error: unknown): number | null {
  if (error && typeof error === 'object' && 'responseCode' in error) {
    const value = Number((error as { responseCode?: unknown }).responseCode);
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

function smtpFailure(error: unknown): DeliveryResult {
  const code = errorCode(error);
  const responseCode = errorResponseCode(error);

  if (code === 'EENVELOPE') {
    return failed('recipient rejected by the mail server', true);
  }
  if (code === 'EAUTH' || responseCode === 535) {
    return failed('mail server authentication failed', true);
  }
  if (responseCode !== null && responseCode >= 500) {
    return failed('mail server rejected the message', true);
  }
  if (code === 'ETIMEDOUT' || code === 'ECONNECTION' || code === 'ESOCKET' || code === 'EDNS') {
    return failed('mail server connection failed', false);
  }
  return failed('mail send failed', false);
}

/**
 * The one place SMTP connection options are built, so the connection check and
 * a real send can never disagree about host, port, encryption or login.
 */
export function smtpOptions(settings: StoreSettings, env: NodeJS.ProcessEnv = process.env) {
  const username = settings.mail_username.trim();
  return {
    host: settings.mail_host.trim(),
    port: Number(settings.mail_port),
    secure: settings.mail_encryption === 'ssl',
    requireTLS: settings.mail_encryption === 'tls',
    auth: username ? { user: username, pass: env.MAIL_PASSWORD ?? '' } : undefined,
    connectionTimeout: PROVIDER_TIMEOUT_MS,
    greetingTimeout: PROVIDER_TIMEOUT_MS,
    socketTimeout: PROVIDER_TIMEOUT_MS,
  };
}

async function sendEmail(input: DeliveryInput, settings: StoreSettings): Promise<DeliveryResult> {
  const problem = mailConfigProblem(settings);
  if (problem) return skipped(problem);

  const recipient = normalizeEmail(input.recipient);
  if (!recipient) return failed('invalid email recipient', true);

  const transport = nodemailer.createTransport(smtpOptions(settings, process.env));

  try {
    const fromEmail = normalizeEmail(settings.mail_from_email);
    const fromName = settings.mail_from_name.replace(/[\r\n]+/g, ' ').trim();
    await transport.sendMail({
      from: fromName ? { name: fromName, address: fromEmail } : fromEmail,
      to: recipient,
      subject: input.subject.replace(/[\r\n]+/g, ' ').trim(),
      text: htmlToText(input.body),
      html: input.body,
    });
    return SENT;
  } catch (error) {
    return smtpFailure(error);
  } finally {
    transport.close();
  }
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

async function sendMsg91(input: DeliveryInput, settings: StoreSettings): Promise<DeliveryResult> {
  const authKey = process.env.MSG91_AUTH_KEY ?? '';
  const mobile = digitsOnly(cleanPhone(input.recipient));
  if (!mobile) return failed('invalid phone recipient', true);

  const form = new URLSearchParams({
    authkey: authKey,
    mobiles: mobile,
    message: input.body,
    sender: settings.sms_sender_id.trim(),
    DLT_TE_ID: settings.sms_dlt_template_id.trim(),
    route: '4',
    country: '91',
  });

  let response: Response;
  try {
    response = await fetch('https://api.msg91.com/api/sendhttp.php', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch {
    return failed('sms provider request failed', false);
  }

  if (!response.ok) {
    return failed(
      response.status === 401 || response.status === 403
        ? 'sms provider authentication failed'
        : response.status >= 500
          ? 'sms provider unavailable'
          : 'sms provider rejected the message',
      response.status === 401 || response.status === 403 || (response.status >= 400 && response.status < 500),
    );
  }

  // MSG91 can answer 200 with a plain-text error. Do not store that text.
  let responseText = '';
  try {
    responseText = (await response.text()).slice(0, 500).toLowerCase();
  } catch {
    return failed('sms provider response could not be read', false);
  }
  if (responseText.includes('error') || responseText.includes('invalid') || responseText.includes('fail')) {
    return failed('sms provider rejected the message', false);
  }
  return SENT;
}

const TWILIO_PERMANENT_CODES = new Set([
  21211, // invalid 'To' number
  21212, // invalid 'From' number
  21214, // 'To' number not verified
  21612, // message cannot be routed
  21614, // 'To' is not a mobile number
  21617, // message body exceeds limit
]);

async function sendTwilio(input: DeliveryInput, settings: StoreSettings): Promise<DeliveryResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID ?? '';
  const authToken = process.env.TWILIO_AUTH_TOKEN ?? '';

  const recipient = cleanPhone(input.recipient);
  if (!recipient) return failed('invalid phone recipient', true);
  if (!recipient.startsWith('+')) {
    return failed('phone recipient is missing a country code', true);
  }

  const form = new URLSearchParams({
    To: recipient,
    From: settings.sms_sender_id.trim(),
    Body: input.body,
  });

  let response: Response;
  try {
    response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
      {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
        cache: 'no-store',
      },
    );
  } catch {
    return failed('sms provider request failed', false);
  }

  if (response.ok) return SENT;

  let providerCode: number | null = null;
  try {
    const parsed = await response.json() as { code?: unknown };
    const code = Number(parsed?.code);
    if (Number.isFinite(code)) providerCode = code;
  } catch {
    // The status code is enough to classify the failure.
  }

  if (providerCode !== null && TWILIO_PERMANENT_CODES.has(providerCode)) {
    return failed('invalid phone recipient', true);
  }
  if (providerCode === 21610) {
    return failed('recipient has opted out of messages', true);
  }
  if (response.status === 401 || response.status === 403) {
    return failed('sms provider authentication failed', true);
  }
  if (response.status === 429 || response.status === 408 || response.status >= 500) {
    return failed('sms provider unavailable', false);
  }
  return failed('sms provider rejected the message', true);
}

async function sendSms(input: DeliveryInput, settings: StoreSettings): Promise<DeliveryResult> {
  const problem = smsConfigProblem(settings);
  if (problem) return skipped(problem);

  if (settings.sms_gateway === 'msg91') return sendMsg91(input, settings);
  if (settings.sms_gateway === 'twilio') return sendTwilio(input, settings);
  return skipped('sms not configured (no gateway chosen)');
}

export async function deliverNotification(
  input: DeliveryInput,
  settings: StoreSettings,
): Promise<DeliveryResult> {
  if (input.channel === 'email') return sendEmail(input, settings);
  return sendSms(input, settings);
}
