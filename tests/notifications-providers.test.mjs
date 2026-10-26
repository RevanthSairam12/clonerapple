import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const here = path.dirname(fileURLToPath(import.meta.url));
const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { '@': path.join(here, '..', 'src') },
});

const {
  deliverNotification,
  htmlToText,
  mailConfigProblem,
  smsConfigProblem,
} = await jiti.import(path.join(here, '..', 'src', 'lib', 'notifications', 'providers.ts'));
const { DEFAULT_SETTINGS } = await jiti.import(
  path.join(here, '..', 'src', 'lib', 'store-admin', 'settings-rules.ts'),
);

const SMTP = {
  ...DEFAULT_SETTINGS,
  mail_driver: 'smtp',
  mail_status: 'on',
  mail_host: 'smtp.example.test',
  mail_port: '587',
  mail_username: 'mailer',
  mail_encryption: 'tls',
  mail_from_email: 'shop@example.test',
  mail_from_name: 'Test Store',
};

const SMS = {
  ...DEFAULT_SETTINGS,
  sms_gateway: 'msg91',
  sms_status: 'on',
  sms_sender_id: 'GADZIO',
};

test('SMTP needs the driver, the switch, a host, a sender and the password', () => {
  assert.match(mailConfigProblem({ ...SMTP, mail_driver: 'log' }, { MAIL_PASSWORD: 'secret' }), /driver/);
  assert.match(mailConfigProblem({ ...SMTP, mail_status: 'off' }, { MAIL_PASSWORD: 'secret' }), /off/);
  assert.match(mailConfigProblem({ ...SMTP, mail_host: '' }, { MAIL_PASSWORD: 'secret' }), /host/);
  assert.match(mailConfigProblem({ ...SMTP, mail_from_email: '' }, { MAIL_PASSWORD: 'secret' }), /From email is missing/);
  assert.match(mailConfigProblem({ ...SMTP, mail_from_email: 'not-an-email' }, { MAIL_PASSWORD: 'secret' }), /From email is invalid/);
  assert.match(mailConfigProblem(SMTP, {}), /MAIL_PASSWORD is missing/);
  assert.equal(mailConfigProblem(SMTP, { MAIL_PASSWORD: 'secret' }), null);
});

test('SMS needs a gateway, the switch, a sender and the right credentials', () => {
  assert.match(smsConfigProblem({ ...SMS, sms_status: 'off' }, { MSG91_AUTH_KEY: 'x' }), /off/);
  assert.match(smsConfigProblem({ ...SMS, sms_gateway: 'none' }, { MSG91_AUTH_KEY: 'x' }), /no gateway/);
  assert.match(smsConfigProblem({ ...SMS, sms_sender_id: '' }, { MSG91_AUTH_KEY: 'x' }), /sender id/);
  assert.match(smsConfigProblem(SMS, {}), /MSG91_AUTH_KEY is missing/);
  assert.equal(smsConfigProblem(SMS, { MSG91_AUTH_KEY: 'x' }), null);

  const twilio = { ...SMS, sms_gateway: 'twilio' };
  assert.match(smsConfigProblem(twilio, { TWILIO_AUTH_TOKEN: 'token' }), /TWILIO_ACCOUNT_SID is missing/);
  assert.match(smsConfigProblem(twilio, { TWILIO_ACCOUNT_SID: 'sid' }), /TWILIO_AUTH_TOKEN is missing/);
  assert.equal(smsConfigProblem(twilio, { TWILIO_ACCOUNT_SID: 'sid', TWILIO_AUTH_TOKEN: 'token' }), null);
});

test('a missing configuration is SKIPPED and never calls a provider', async () => {
  const mail = await deliverNotification(
    { channel: 'email', recipient: 'buyer@example.test', subject: 'Hi', body: '<p>Hi</p>' },
    { ...DEFAULT_SETTINGS },
  );
  assert.equal(mail.outcome, 'SKIPPED');
  assert.match(mail.reason, /mail not configured/);

  const sms = await deliverNotification(
    { channel: 'sms', recipient: '9876543210', subject: '', body: 'Hi' },
    { ...DEFAULT_SETTINGS },
  );
  assert.equal(sms.outcome, 'SKIPPED');
  assert.match(sms.reason, /sms not configured/);
});

test('a missing secret is named, never echoed', async () => {
  const secret = 'super-secret-value-that-must-not-leak';
  const mail = await deliverNotification(
    { channel: 'email', recipient: 'buyer@example.test', subject: 'Hi', body: 'Hi' },
    SMTP,
  );
  assert.equal(mail.outcome, 'SKIPPED');
  assert.doesNotMatch(mail.reason, new RegExp(secret));

  const envReason = mailConfigProblem(SMTP, { MAIL_PASSWORD: secret });
  assert.equal(envReason, null);

  const sms = await deliverNotification(
    { channel: 'sms', recipient: '9876543210', subject: '', body: 'Hi' },
    { ...SMS, sms_gateway: 'twilio' },
  );
  assert.equal(sms.outcome, 'SKIPPED');
  assert.doesNotMatch(sms.reason, new RegExp(secret));
});

test('the plain-text alternative keeps the message without markup', () => {
  const text = htmlToText(
    '<!doctype html><html><body><style>.x{color:red}</style><script>alert(1)</script><h1>Order</h1><p>Line one</p><p>Line two &amp; more</p></body></html>',
  );
  assert.match(text, /Order/);
  assert.match(text, /Line one/);
  assert.match(text, /Line two & more/);
  assert.doesNotMatch(text, /<[^>]+>/);
  assert.doesNotMatch(text, /alert\(1\)/);
});
