/**
 * Notification readiness check. Needs no running server.
 *
 *   node scripts/check-notifications.mjs                   # inspect, never send
 *   node scripts/check-notifications.mjs --send-to me@x.com  # also send one test email
 *
 * What it does:
 *   1. loads .env.local and reports which credentials EXIST (names only);
 *   2. reads the saved settings and the notification matrix (read-only);
 *   3. renders every event x channel x audience template with sample data and
 *      fails on an unresolved placeholder, an unknown variable or a secret;
 *   4. runs the SMTP verify (connect + login, sends nothing) when it can;
 *   5. writes an HTML preview of every email to tmp/notification-previews/
 *      (git-ignored) and prints a pass/fail table.
 *
 * It never sends mail unless --send-to <address> is passed. Secret values are
 * never printed.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createJiti } from 'jiti';
import postgres from 'postgres';

const root = process.cwd();
const args = process.argv.slice(2);
const sendToIndex = args.indexOf('--send-to');
const sendTo = sendToIndex >= 0 ? args[sendToIndex + 1] : null;
if (sendToIndex >= 0 && (!sendTo || sendTo.startsWith('--'))) {
  console.error('--send-to needs an email address.');
  process.exit(2);
}

/* ------------------------------------------------------------ env */

try {
  for (const line of readFileSync(path.join(root, '.env.local'), 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && !(match[1] in process.env)) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
} catch {
  console.log('note: no .env.local found; using the real environment only.');
}

const jiti = createJiti(import.meta.url, { alias: { '@': path.join(root, 'src') } });
const load = (file) => jiti.import(path.join(root, 'src', ...file.split('/')));
const types = await load('lib/notifications/types.ts');
const templates = await load('lib/notifications/templates.ts');
const diagnostics = await load('lib/notifications/diagnostics.ts');
const providers = await load('lib/notifications/providers.ts');
const rules = await load('lib/store-admin/settings-rules.ts');

const rows = [];
const record = (area, check, ok, detail = '') => rows.push({ area, check, ok, detail });

/* --------------------------------------------------- credentials */

const SECRET_NAMES = [
  'MAIL_PASSWORD',
  'MSG91_AUTH_KEY',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'PAYU_KEY',
  'PAYU_SALT',
  'CRON_SECRET',
  'DATABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
];
const present = (name) => Boolean(process.env[name]?.trim());
console.log('\nCredentials in the environment (names only):');
for (const name of [...SECRET_NAMES, 'APP_BASE_URL']) {
  console.log(`  ${present(name) ? 'present' : 'MISSING'}  ${name}`);
}
const secretValues = SECRET_NAMES.map((name) => process.env[name]?.trim()).filter(
  (value) => value && value.length >= 6,
);

/* ------------------------------------------------------- settings */

let settings = { ...rules.DEFAULT_SETTINGS };
let matrix = null;
let dbOk = false;
let storedEmails = [];
if (present('DATABASE_URL')) {
  const sql = postgres(process.env.DATABASE_URL, {
    ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require',
    max: 1,
    connect_timeout: 10,
  });
  try {
    for (const row of await sql`select key, value from store_settings`) {
      if (rules.isStoreSettingKey(row.key)) settings[row.key] = String(row.value ?? '');
    }
    matrix = await sql`select channel, audience, topic, is_active from notification_channel_settings`;
    storedEmails = await sql`
      select template_key, subject, heading, body, button_label, button_url, footer_text
      from email_templates where is_active`;
    dbOk = true;
  } catch {
    console.log('note: the database could not be read; using default settings.');
  } finally {
    await sql.end({ timeout: 2 }).catch(() => {});
  }
}
record('database', 'settings and matrix readable', dbOk, dbOk ? '' : 'DATABASE_URL missing or unreachable');

/* ----------------------------------------------------- templates */

const SAMPLE = {
  txnid: 'GDZ1001',
  orderNumber: 'GDZ1001',
  customerName: 'Asha Rao',
  orderTotalPaise: 149900,
  shippingPaise: 4900,
  refundPaise: 49900,
  discountPaise: 10000,
  couponCode: 'WELCOME10',
  orderStatus: 'PAID',
  trackingNumber: 'TRK123456',
  trackingLink: 'https://track.example.test/TRK123456',
  itemCount: 2,
  productName: 'Gadzio MagSafe Case',
  stockAvailable: 3,
  storeName: settings.trade_name || 'Gadzio',
  supportPhone: settings.support_phone || '+91 90000 00000',
  supportEmail: settings.support_email || 'support@example.test',
  returnWindowDays: settings.return_window_days || '7',
};
const baseUrl = (process.env.APP_BASE_URL || 'https://example.test').replace(/\/+$/, '');

const previewDir = path.join(root, 'tmp', 'notification-previews');
rmSync(previewDir, { recursive: true, force: true });
mkdirSync(previewDir, { recursive: true });

const TOKEN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
const known = new Set(templates.TEMPLATE_VARIABLES);

function inspect(label, parts, values, rendered) {
  const problems = [];
  const raw = Object.values(parts).join('\n');
  for (const match of raw.matchAll(TOKEN)) {
    const name = match[1].toLowerCase();
    if (!known.has(name)) problems.push(`unknown variable {{${name}}}`);
    else if (!values[name]) problems.push(`{{${name}}} resolved empty`);
  }
  const output = `${rendered.subject}\n${rendered.text}\n${rendered.html ?? ''}`;
  if (/\{\{|\}\}/.test(output)) problems.push('unresolved placeholder in output');
  if (/undefined|\[object Object\]|NaN/.test(output)) problems.push('undefined/NaN in output');
  if (secretValues.some((secret) => output.includes(secret))) problems.push('a secret value appears in output');
  return { label, problems };
}

const storedByKey = new Map(storedEmails.map((row) => [row.template_key, row]));
let rendered = 0;
let failures = 0;
const index = [];

for (const event of types.NOTIFICATION_EVENTS) {
  for (const audience of ['customer', 'staff']) {
    const link = audience === 'staff' ? `/store-admin/orders/${SAMPLE.txnid}` : `/order/status?txnid=${SAMPLE.txnid}`;
    const values = templates.templateValues({ audience, ...SAMPLE, adminLink: link });
    for (const channel of ['email', 'sms', 'inapp']) {
      const parts = templates.defaultTemplate(event, channel, audience);
      const out = templates.renderEmail(parts, values, baseUrl);
      const text = channel === 'email' ? out : { subject: out.subject, text: templates.renderText(parts.body, values, true), html: '' };
      const { problems } = inspect(`${event}/${channel}/${audience}`, parts, values, text);
      rendered += 1;
      if (problems.length) {
        failures += 1;
        record('template', `${event} / ${channel} / ${audience}`, false, problems.join('; '));
      }
      if (channel === 'email') {
        const file = `${event}.${audience}.html`;
        writeFileSync(path.join(previewDir, file), out.html);
        index.push({ file, subject: out.subject });
      }
      if (channel === 'sms' && text.text.length > 160) {
        record('template', `${event} / sms / ${audience}`, false, `${text.text.length} characters (over one 160-character segment)`);
        failures += 1;
      }
    }
  }
}
for (const [key, row] of storedByKey) {
  for (const audience of ['customer', 'staff']) {
    const link = audience === 'staff' ? `/store-admin/orders/${SAMPLE.txnid}` : `/order/status?txnid=${SAMPLE.txnid}`;
    const values = templates.templateValues({ audience, ...SAMPLE, adminLink: link });
    const parts = {
      subject: row.subject ?? '', heading: row.heading ?? '', body: row.body ?? '',
      buttonLabel: row.button_label ?? '', buttonUrl: row.button_url ?? '', footer: row.footer_text ?? '',
    };
    const out = templates.renderEmail(parts, values, baseUrl);
    const { problems } = inspect(`stored:${key}/${audience}`, parts, values, out);
    rendered += 1;
    if (problems.length) {
      failures += 1;
      record('stored template', `${key} / ${audience}`, false, problems.join('; '));
    }
    writeFileSync(path.join(previewDir, `stored-${key}.${audience}.html`), out.html);
  }
}
record('templates', `${rendered} templates rendered, no unresolved placeholders or secrets`, failures === 0,
  failures ? `${failures} failing` : '');

writeFileSync(
  path.join(previewDir, 'index.html'),
  `<!doctype html><meta charset="utf-8"><title>Email previews</title><body style="font-family:Arial;max-width:720px;margin:24px auto"><h1>Email previews</h1><ul>${
    index.map((item) => `<li><a href="${item.file}">${item.file}</a> &mdash; ${item.subject.replace(/[<>&]/g, '')}</li>`).join('')
  }</ul></body>`,
);

/* -------------------------------------------------------- sending */

const mailProblem = providers.mailConfigProblem(settings);
const smsProblem = providers.smsConfigProblem(settings);
record('email', 'ready to send real email', mailProblem === null, mailProblem ?? '');
record('sms', 'ready to send real SMS', smsProblem === null, smsProblem ?? '');

const setup = diagnostics.smtpSetupProblem(settings);
if (setup) {
  record('email', 'SMTP connection check', false, `skipped: ${setup}`);
} else {
  const outcome = await diagnostics.checkMailConnection(settings);
  record('email', 'SMTP connection check', outcome.ok, outcome.message);
}

if (matrix) {
  const on = (channel) => matrix.filter((cell) => cell.channel === channel && cell.is_active);
  const customerEmail = on('email').filter((cell) => cell.audience === 'customer').length;
  const staffEmail = on('email').filter((cell) => cell.audience === 'admin').length;
  const customerSms = on('sms').filter((cell) => cell.audience === 'customer').length;
  record('matrix', 'at least one customer email cell is on', customerEmail > 0, `${customerEmail} on`);
  record('matrix', 'at least one staff email cell is on', staffEmail > 0, `${staffEmail} on`);
  record('matrix', 'at least one customer SMS cell is on', customerSms > 0, `${customerSms} on`);
}

if (sendTo) {
  const outcome = await diagnostics.sendTestEmail(settings, sendTo);
  record('email', 'test email sent (--send-to)', outcome.ok, outcome.message);
} else {
  console.log('\nNo message was sent. Pass --send-to <address> to send one test email.');
}

/* --------------------------------------------------------- report */

const width = Math.max(...rows.map((row) => row.check.length), 10);
console.log('\nResult  Area            Check'.padEnd(width + 30));
for (const row of rows) {
  console.log(`${row.ok ? 'PASS  ' : 'FAIL  '}  ${row.area.padEnd(14)}  ${row.check.padEnd(width)}  ${row.detail}`);
}
console.log(`\nEmail previews: ${path.relative(root, previewDir)}${path.sep}index.html`);

const failed = rows.filter((row) => !row.ok);
console.log(`\n${rows.length - failed.length} passed, ${failed.length} failed.`);
// Not-ready-to-send is a finding, not a script fault; only a broken template or
// an unsafe render fails the process.
process.exit(failures > 0 ? 1 : 0);
