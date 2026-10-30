/**
 * Mail and SMS verification tools: classification, connection check, test
 * sends (with stubs), configuration status, and the owner-only route shape.
 * Secrets must never appear in a result, a status list or an audit payload.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');
const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { '@': path.join(root, 'src') },
});
const diagnostics = await jiti.import(path.join(root, 'src', 'lib', 'notifications', 'diagnostics.ts'));
const providers = await jiti.import(path.join(root, 'src', 'lib', 'notifications', 'providers.ts'));
const rateLimit = await jiti.import(path.join(root, 'src', 'lib', 'payu', 'rate-limit.ts'));
const { DEFAULT_SETTINGS } = await jiti.import(path.join(root, 'src', 'lib', 'store-admin', 'settings-rules.ts'));

const SECRET = 'S3cr3t-Passw0rd-Do-Not-Leak';
const SMTP = {
  ...DEFAULT_SETTINGS,
  mail_driver: 'smtp',
  mail_status: 'off', // a check works before sending is switched on
  mail_host: 'smtp.example.test',
  mail_port: '587',
  mail_username: 'mailer-user',
  mail_encryption: 'tls',
  mail_from_email: 'shop@example.test',
  mail_from_name: 'Test Store',
  trade_name: 'Test Store',
};
const ENV = { MAIL_PASSWORD: SECRET };

function stubTransport({ verifyError = null, sendError = null } = {}) {
  const calls = { options: null, sent: [], verified: 0, closed: 0 };
  const createTransport = (options) => {
    calls.options = options;
    return {
      async verify() {
        calls.verified += 1;
        if (verifyError) throw verifyError;
        return true;
      },
      async sendMail(message) {
        if (sendError) throw sendError;
        calls.sent.push(message);
        return { accepted: [message.to] };
      },
      close() {
        calls.closed += 1;
      },
    };
  };
  return { calls, createTransport };
}
const err = (code, extra = {}) => Object.assign(new Error(`${SECRET} boom ${code}`), { code, ...extra });

test('SMTP failures are classified from codes, never from messages', () => {
  const c = diagnostics.classifySmtpFailure;
  assert.equal(c(err('EAUTH', { responseCode: 535 })), 'bad_credentials');
  assert.equal(c(err('ECONNECTION', { originalCode: 'ECONNREFUSED' })), 'connection_refused');
  assert.equal(c(err('ETIMEDOUT')), 'timeout');
  assert.equal(c(err('ETLS')), 'tls_problem');
  assert.equal(c(err('ESOCKET', { originalCode: 'ERR_SSL_WRONG_VERSION_NUMBER' })), 'tls_problem');
  assert.equal(c(err('EDNS', { originalCode: 'ENOTFOUND' })), 'dns_failure');
  assert.equal(c(err('EENVELOPE')), 'recipient_rejected');
  assert.equal(c(new Error('something odd')), 'unknown');
});

test('the connection check connects and logs in, and sends nothing', async () => {
  const { calls, createTransport } = stubTransport();
  const outcome = await diagnostics.checkMailConnection(SMTP, { env: ENV, createTransport });
  assert.equal(outcome.ok, true);
  assert.equal(calls.verified, 1);
  assert.equal(calls.sent.length, 0, 'verify must not send');
  assert.equal(calls.closed, 1);
  assert.match(outcome.message, /No email was sent/);
});

test('the check uses exactly the options a real send uses', async () => {
  const { calls, createTransport } = stubTransport();
  await diagnostics.checkMailConnection({ ...SMTP, mail_encryption: 'ssl', mail_port: '465' }, { env: ENV, createTransport });
  assert.deepEqual(calls.options, providers.smtpOptions({ ...SMTP, mail_encryption: 'ssl', mail_port: '465' }, ENV));
  assert.equal(calls.options.secure, true);
  assert.equal(calls.options.host, 'smtp.example.test');
});

test('each failure is reported in plain words and leaks nothing', async () => {
  const cases = [
    [err('EAUTH', { responseCode: 535 }), 'bad_credentials', /refused the login/],
    [err('ECONNECTION', { originalCode: 'ECONNREFUSED' }), 'connection_refused', /Connection refused/],
    [err('ETIMEDOUT'), 'timeout', /did not answer in time/],
    [err('ETLS'), 'tls_problem', /secure connection/],
  ];
  for (const [error, code, pattern] of cases) {
    const { createTransport } = stubTransport({ verifyError: error });
    const outcome = await diagnostics.checkMailConnection(SMTP, { env: ENV, createTransport });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.code, code);
    assert.match(outcome.message, pattern);
    const text = JSON.stringify(outcome);
    for (const forbidden of [SECRET, 'mailer-user', 'smtp.example.test', 'boom', 'at Object', 'stack']) {
      assert.equal(text.includes(forbidden), false, `${code} leaked ${forbidden}`);
    }
  }
});

test('missing configuration is reported as not configured, without connecting', async () => {
  const { calls, createTransport } = stubTransport();
  const noHost = await diagnostics.checkMailConnection({ ...SMTP, mail_host: '' }, { env: ENV, createTransport });
  assert.equal(noHost.code, 'not_configured');
  assert.match(noHost.message, /host is missing/);
  const noPassword = await diagnostics.checkMailConnection(SMTP, { env: {}, createTransport });
  assert.equal(noPassword.code, 'not_configured');
  assert.match(noPassword.message, /MAIL_PASSWORD is not set/);
  assert.equal(calls.verified, 0);
});

test('the test email is clearly labelled and goes only to the typed address', async () => {
  const { calls, createTransport } = stubTransport();
  const outcome = await diagnostics.sendTestEmail(SMTP, ' Owner@Example.test ', { env: ENV, createTransport });
  assert.equal(outcome.ok, true);
  assert.equal(calls.sent.length, 1);
  const [message] = calls.sent;
  assert.equal(message.to, 'owner@example.test');
  assert.match(message.subject, /^\[TEST\]/);
  assert.match(message.text, /test email/i);
  assert.doesNotMatch(JSON.stringify(outcome), new RegExp(SECRET));
});

test('a bad address, a missing From and a send failure are all plain results', async () => {
  const { createTransport } = stubTransport();
  assert.equal((await diagnostics.sendTestEmail(SMTP, 'nope', { env: ENV, createTransport })).code, 'invalid_recipient');
  assert.equal((await diagnostics.sendTestEmail({ ...SMTP, mail_from_email: '' }, 'a@b.co', { env: ENV, createTransport })).code, 'not_configured');
  const failing = stubTransport({ sendError: err('EAUTH', { responseCode: 535 }) });
  const outcome = await diagnostics.sendTestEmail(SMTP, 'a@b.co', { env: ENV, createTransport: failing.createTransport });
  assert.equal(outcome.code, 'bad_credentials');
  assert.equal(JSON.stringify(outcome).includes(SECRET), false);
});

/* -------------------------------------------------------------- SMS */

const MSG91 = { ...DEFAULT_SETTINGS, sms_gateway: 'msg91', sms_status: 'off', sms_sender_id: 'GADZIO', trade_name: 'Test Store' };

async function withFetch(stub, run) {
  const saved = globalThis.fetch;
  const savedEnv = { ...process.env };
  globalThis.fetch = stub;
  try {
    return await run();
  } finally {
    globalThis.fetch = saved;
    for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
    Object.assign(process.env, savedEnv);
  }
}

test('MSG91 without a DLT template id says so and does not call the gateway', async () => {
  let called = false;
  const outcome = await withFetch(async () => { called = true; return new Response('ok'); }, async () => {
    process.env.MSG91_AUTH_KEY = SECRET;
    return diagnostics.sendTestSms(MSG91, '+919876543210');
  });
  assert.equal(called, false);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, 'dlt_required');
  assert.match(outcome.message, /DLT template id/);
  assert.equal(JSON.stringify(outcome).includes(SECRET), false);
});

test('MSG91 with a template id sends it as DLT_TE_ID and reports success honestly', async () => {
  let sentBody = '';
  const outcome = await withFetch(async (_url, init) => { sentBody = String(init.body); return new Response('abc123'); }, async () => {
    process.env.MSG91_AUTH_KEY = SECRET;
    return diagnostics.sendTestSms({ ...MSG91, sms_dlt_template_id: 'TPL123' }, '+919876543210');
  });
  assert.equal(outcome.ok, true);
  assert.match(outcome.message, /DLT template/);
  assert.match(sentBody, /DLT_TE_ID=TPL123/);
  assert.equal(JSON.stringify(outcome).includes(SECRET), false);
});

test('missing gateway credentials are named by variable, never by value', async () => {
  const outcome = await withFetch(async () => new Response('ok'), async () => {
    delete process.env.MSG91_AUTH_KEY;
    return diagnostics.sendTestSms({ ...MSG91, sms_dlt_template_id: 'TPL123' }, '+919876543210');
  });
  assert.equal(outcome.code, 'not_configured');
  assert.match(outcome.message, /MSG91_AUTH_KEY is missing/);
});

test('a gateway rejection and a bad number are plain results', async () => {
  const rejected = await withFetch(async () => new Response('error: bad', { status: 200 }), async () => {
    process.env.MSG91_AUTH_KEY = SECRET;
    return diagnostics.sendTestSms({ ...MSG91, sms_dlt_template_id: 'T' }, '+919876543210');
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, 'provider_error');
  assert.equal((await diagnostics.sendTestSms(MSG91, 'abc')).code, 'invalid_recipient');
});

test('real sending needs the DLT template id too, so a send is never falsely "sent"', () => {
  const ready = { ...MSG91, sms_status: 'on' };
  assert.match(providers.smsConfigProblem(ready, { MSG91_AUTH_KEY: 'x' }), /DLT template id/);
  assert.equal(providers.smsConfigProblem({ ...ready, sms_dlt_template_id: 'T' }, { MSG91_AUTH_KEY: 'x' }), null);
  const twilio = { ...ready, sms_gateway: 'twilio' };
  assert.equal(providers.smsConfigProblem(twilio, { TWILIO_ACCOUNT_SID: 's', TWILIO_AUTH_TOKEN: 't' }), null);
});

/* ------------------------------------------------ configuration status */

test('configuration status lists names and presence only', () => {
  const env = { MAIL_PASSWORD: SECRET, CRON_SECRET: 'cron-value-xyz', MSG91_AUTH_KEY: 'msg-key-abc' };
  const items = diagnostics.configurationStatus({ ...SMTP, mail_status: 'on' }, env);
  const byName = Object.fromEntries(items.map((item) => [item.name, item.present]));
  assert.equal(byName.MAIL_PASSWORD, true);
  assert.equal(byName.MSG91_AUTH_KEY, true);
  assert.equal(byName.sms_dlt_template_id, false);
  assert.equal(byName.APP_BASE_URL, false);
  const text = JSON.stringify(items);
  for (const value of [SECRET, 'cron-value-xyz', 'msg-key-abc', 'smtp.example.test', 'mailer-user']) {
    assert.equal(text.includes(value), false, `status leaked a value`);
  }
});

/* ------------------------------------------------------------- route */

test('the route is owner-only, same-origin checked, rate limited and audited', () => {
  const source = read('src/app/api/store-admin/mail-check/route.ts');
  assert.match(source, /requireStoreRole\(\s*'store_owner'\s*\)/);
  assert.match(source, /assertSameOrigin\(request\)/);
  assert.match(source, /checkRateLimit\(/);
  assert.match(source, /writeAudit\(/);
  assert.ok(source.indexOf('assertSameOrigin(request)') < source.indexOf('requireStoreRole('));
  assert.ok(
    source.indexOf('requireStoreRole(') < source.indexOf('checkRateLimit('),
    'a viewer must not use up the limit',
  );
});

test('audit rows carry the outcome code and a masked recipient only', () => {
  const source = read('src/app/api/store-admin/mail-check/route.ts');
  assert.match(source, /recipient_email: maskEmail\(to\)/);
  assert.match(source, /recipient_phone: maskPhone\(to\)/);
  assert.doesNotMatch(source, /(after|before):[^}]*\bmessage:/s, 'the result text is not stored');
  assert.doesNotMatch(source, /process\.env/, 'the route never reads secrets itself');
});

test('the limit is a few per hour and denies the sixth', () => {
  const route = read('src/app/api/store-admin/mail-check/route.ts');
  assert.match(route, /limit: 5, windowMs: 60 \* 60 \* 1000/);
  const key = `test-mail-check-${Date.now()}`;
  const options = { limit: 5, windowMs: 60 * 60 * 1000 };
  for (let i = 0; i < 5; i += 1) assert.equal(rateLimit.checkRateLimit(key, options).allowed, true);
  const sixth = rateLimit.checkRateLimit(key, options);
  assert.equal(sixth.allowed, false);
  assert.ok(sixth.retryAfterSec > 0);
});

test('the panel is owner-only on the page and never receives a secret', () => {
  const page = read('src/app/(store-admin)/store-admin/(protected)/settings/mail/page.tsx');
  assert.match(page, /isOwner \? \(\s*<MailChecksPanel/);
  const panel = read('src/components/store-admin/MailChecksPanel.tsx');
  assert.doesNotMatch(panel, /MAIL_PASSWORD|process\.env/);
});
