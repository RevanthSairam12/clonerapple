/**
 * Live proof that the notification matrix decides what is queued.
 *
 * Runs against a throwaway schema cloned from the public tables, so the real
 * SQL (including the unique dedupe key and the outbox checks) is exercised
 * without writing a production row. Skipped when DATABASE_URL is unset or
 * points at a transaction pooler (port 6543), like the other integration tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import postgres from 'postgres';
import { createFixtureSchema, dropFixtureSchema } from './helpers/isolated-schema.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

if (process.env.RUN_LEGACY_DB_TESTS === '1' && !process.env.DATABASE_URL) {
  try {
    const env = await readFile(path.join(here, '..', '.env.local'), 'utf8');
    for (const line of env.split('\n')) {
      const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
  } catch {
    // No .env.local; the test stays skipped.
  }
}

function connectionDetails() {
  const url = new URL(process.env.DATABASE_URL);
  return {
    transactionPooler: url.port === '6543',
  };
}

const skip = process.env.RUN_LEGACY_DB_TESTS !== '1'
  ? 'legacy database tests require explicit RUN_LEGACY_DB_TESTS=1 approval'
  : !process.env.DATABASE_URL
  ? 'DATABASE_URL is not set'
  : connectionDetails().transactionPooler
    ? 'temporary-schema isolation needs a session connection (not port 6543)'
    : false;

function client() {
  if (process.env.RUN_LEGACY_DB_TESTS !== '1') throw new Error('Legacy database tests are disabled');
  return postgres(process.env.DATABASE_URL, {
    max: 1,
    ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require',
    prepare: false,
    connection: { search_path: 'pg_catalog' },
    onnotice: () => {},
  });
}

const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { '@': path.join(here, '..', 'src') },
});
const { enqueueNotification } = await jiti.import(
  path.join(here, '..', 'src', 'lib', 'notifications', 'enqueue.ts'),
);

const TABLES = [
  'notification_channel_settings',
  'email_templates',
  'automated_messages',
  'store_settings',
  'store_admins',
  'notification_outbox',
];

async function setMatrix(sql, cells) {
  await sql`delete from notification_channel_settings`;
  for (const [channel, audience, topic, active] of cells) {
    await sql`
      insert into notification_channel_settings (id, channel, audience, topic, is_active)
      values (${`${channel}:${audience}:${topic}`}, ${channel}, ${audience}, ${topic}, ${active})
    `;
  }
}

async function rowsFor(sql, entityId) {
  return await sql`
    select event_key, audience, channel, recipient, recipient_masked,
           subject, body, status, reason
    from notification_outbox
    where entity_id = ${entityId}
    order by channel, recipient
  `;
}

test('enqueue follows the matrix, remembers why nothing was sent, and never duplicates', { skip }, async () => {
  const suffix = `${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
  const schema = `itest_notify_${suffix}`;
  const ownerEmail = `owner-${suffix}@store.test`;
  const a = client();

  try {
    await createFixtureSchema(a, schema, TABLES);
    const pinned = await a`show search_path`;
    assert.ok(String(pinned[0].search_path).includes(schema), 'connection is pinned to the test schema');

    await a`
      insert into store_settings (key, value) values
        ('trade_name', 'Test Store'),
        ('email', 'hello@store.test'),
        ('phone', '9123456780'),
        ('return_window_days', '10')
    `;
    await a`
      insert into store_admins (id, email, password_hash, name, role, is_active)
      values (${`owner_${suffix}`}, ${ownerEmail}, 'x', 'Owner', 'store_owner', true)
    `;

    /* ------------------------------------------ disabled cells send nothing */
    await setMatrix(a, [
      ['email', 'customer', 'order_placed', false],
      ['sms', 'customer', 'order_placed', false],
    ]);
    const disabled = await enqueueNotification(
      'order_placed',
      { type: 'order', id: `NODISC${suffix}` },
      { txnid: `NODISC${suffix}`, customerEmail: 'buyer@example.test' },
      a,
    );
    assert.equal(disabled.ok, true);
    assert.equal(disabled.queued, 0);
    assert.equal(disabled.skipped, 0);
    assert.equal((await rowsFor(a, `NODISC${suffix}`)).length, 0);

    /* ----------------------- guest with email only: email yes, SMS skipped */
    await setMatrix(a, [
      ['email', 'customer', 'order_placed', true],
      ['sms', 'customer', 'order_placed', true],
    ]);
    const guestId = `GUEST${suffix}`;
    const guest = await enqueueNotification(
      'order_placed',
      { type: 'order', id: guestId },
      {
        txnid: guestId,
        customerName: 'Guest Buyer',
        customerEmail: 'guest@example.test',
        customerPhone: null,
        orderTotalPaise: 199900,
        itemCount: 1,
      },
      a,
    );
    assert.equal(guest.ok, true);
    assert.equal(guest.queued, 1);
    assert.equal(guest.skipped, 1);

    let rows = await rowsFor(a, guestId);
    assert.equal(rows.length, 2);
    const emailRow = rows.find((row) => row.channel === 'email');
    const smsRow = rows.find((row) => row.channel === 'sms');
    assert.equal(emailRow.status, 'QUEUED');
    assert.equal(emailRow.recipient, 'guest@example.test');
    assert.equal(emailRow.recipient_masked, 'g***@example.test');
    assert.notEqual(emailRow.recipient_masked, emailRow.recipient);
    assert.doesNotMatch(emailRow.body, /\{\{/, 'no token survives rendering');
    assert.match(emailRow.subject, /GUEST/);
    assert.equal(smsRow.status, 'SKIPPED');
    assert.equal(smsRow.reason, 'no customer phone number');
    assert.equal(smsRow.recipient, '');
    assert.equal(smsRow.body, '');
    assert.equal(smsRow.subject, '');

    const duplicate = await enqueueNotification(
      'order_placed',
      { type: 'order', id: guestId },
      {
        txnid: guestId,
        customerName: 'Guest Buyer',
        customerEmail: 'guest@example.test',
        customerPhone: null,
        orderTotalPaise: 199900,
        itemCount: 1,
      },
      a,
    );
    assert.equal(duplicate.duplicates, 2, 'both rows already existed');
    assert.equal((await rowsFor(a, guestId)).length, 2, 'a duplicate call adds nothing');

    /* ----------------------------- stored template wins, values are escaped */
    await a`
      insert into email_templates (id, template_key, name, subject, heading, body, is_active)
      values (${`et_${suffix}`}, 'order_placed', 'Order copy', 'Hi {{customer_name}}',
              'Order {{order_number}}', 'Body {{order_number}} {{not_a_variable}} <script>alert(1)</script>', true)
    `;
    const escapedId = `ESCAPE${suffix}`;
    await enqueueNotification(
      'order_placed',
      { type: 'order', id: escapedId },
      {
        txnid: escapedId,
        customerName: '<script>alert(2)</script>',
        customerEmail: 'escape@example.test',
        orderTotalPaise: 100,
      },
      a,
    );
    const escaped = (await rowsFor(a, escapedId)).find((row) => row.channel === 'email');
    assert.match(escaped.subject, /^Hi <script>alert\(2\)<\/script>$/);
    assert.match(escaped.body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(escaped.body, /<script>alert/);
    assert.doesNotMatch(escaped.body, /not_a_variable/);
    assert.match(escaped.body, /Order ESCAPE/);

    /* ------------------------- staff fan-out uses support email + owners */
    await setMatrix(a, [
      ['email', 'admin', 'payment_received', true],
    ]);
    const paidId = `PAID${suffix}`;
    const paid = await enqueueNotification(
      'payment_received',
      { type: 'order', id: paidId },
      {
        txnid: paidId,
        customerName: 'Ravi Kumar',
        customerEmail: 'ravi@example.test',
        orderTotalPaise: 250000,
      },
      a,
    );
    assert.equal(paid.queued, 2, 'support address and the active owner');
    const staffRows = await rowsFor(a, paidId);
    assert.deepEqual(
      staffRows.map((row) => row.recipient).sort(),
      ['hello@store.test', ownerEmail].sort(),
    );
    for (const row of staffRows) {
      assert.equal(row.audience, 'staff');
      assert.equal(row.status, 'QUEUED');
      assert.doesNotMatch(row.recipient_masked, /@.*@/);
      assert.notEqual(row.recipient_masked, row.recipient);
      assert.doesNotMatch(row.body, /Ravi Kumar/, 'staff messages never name the customer');
    }

    /* ---------- payment success is one message per order, however it arrives */
    await setMatrix(a, [
      ['email', 'customer', 'payment_received', true],
      ['email', 'admin', 'payment_received', true],
    ]);
    const onceId = `ONCE${suffix}`;
    const onceContext = {
      txnid: onceId,
      customerName: 'Asha Rao',
      customerEmail: 'once@example.test',
      customerPhone: '9876543210',
      orderTotalPaise: 500000,
      customerLink: `/order/status?txnid=${onceId}`,
      staffLink: `/store-admin/orders/${onceId}`,
    };
    const firstPayment = await enqueueNotification(
      'payment_received',
      { type: 'order', id: onceId },
      onceContext,
      a,
    );
    assert.equal(firstPayment.queued, 3, 'one customer email plus support and the owner');
    const secondPayment = await enqueueNotification(
      'payment_received',
      { type: 'order', id: onceId },
      onceContext,
      a,
    );
    assert.equal(secondPayment.duplicates, 3, 'a duplicate callback or reconcile adds nothing');
    const onceRows = await rowsFor(a, onceId);
    assert.equal(onceRows.length, 3);

    const customerPaid = onceRows.find((row) => row.audience === 'customer');
    assert.match(customerPaid.body, new RegExp(`/order/status\\?txnid=${onceId}`));
    assert.doesNotMatch(customerPaid.body, /\/store-admin\/orders\//);
    for (const row of onceRows.filter((entry) => entry.audience === 'staff')) {
      assert.match(row.body, new RegExp(`/store-admin/orders/${onceId}`));
      assert.doesNotMatch(row.body, /\/order\/status\?txnid=/);
    }

    /* ------------------------ an auto-cancel sends once, not once per tick */
    await setMatrix(a, [
      ['email', 'customer', 'cancelled', true],
      ['email', 'admin', 'cancelled', true],
    ]);
    const cancelId = `AUTOCANCEL${suffix}`;
    const cancelContext = {
      txnid: cancelId,
      customerName: 'Asha Rao',
      customerEmail: 'cancel@example.test',
      orderTotalPaise: 250000,
    };
    await enqueueNotification(
      'cancelled',
      { type: 'order', id: cancelId },
      cancelContext,
      a,
    );
    await enqueueNotification(
      'cancelled',
      { type: 'order', id: cancelId },
      cancelContext,
      a,
    );
    assert.equal((await rowsFor(a, cancelId)).length, 3, 'one cancellation, one message');

    /* ------------------- targeted staff reset goes only to that staff member */
    await setMatrix(a, [
      ['email', 'admin', 'password_reset', true],
    ]);
    const resetId = `RESET${suffix}`;
    await enqueueNotification(
      'password_reset',
      { type: 'staff', id: resetId },
      { staffEmail: 'member@store.test', staffPhone: '' },
      a,
    );
    const resetRows = await rowsFor(a, resetId);
    assert.equal(resetRows.length, 1);
    assert.equal(resetRows[0].recipient, 'member@store.test');
    assert.equal(resetRows[0].recipient_masked, 'm***@store.test');

    /* ------------------------------ in-app staff is the delivery, so SENT */
    await setMatrix(a, [
      ['inapp', 'admin', 'cancelled', true],
      ['inapp', 'customer', 'cancelled', true],
    ]);
    const inappId = `INAPP${suffix}`;
    await enqueueNotification(
      'cancelled',
      { type: 'order', id: inappId },
      { txnid: inappId },
      a,
    );
    const inappRows = await rowsFor(a, inappId);
    const staffInapp = inappRows.find((row) => row.audience === 'staff');
    const customerInapp = inappRows.find((row) => row.audience === 'customer');
    assert.equal(staffInapp.status, 'SENT');
    assert.equal(staffInapp.recipient, 'staff');
    assert.equal(customerInapp.status, 'SKIPPED');
    assert.equal(customerInapp.reason, 'no customer in-app inbox');

    /* --------------------- a token lets a genuinely repeated event through */
    await setMatrix(a, [
      ['email', 'customer', 'refund_requested', true],
    ]);
    const repeatId = `REPEAT${suffix}`;
    const repeatContext = {
      txnid: repeatId,
      customerEmail: 'repeat@example.test',
      customerPhone: '9876543210',
    };
    await enqueueNotification(
      'refund_requested',
      { type: 'order', id: repeatId },
      { ...repeatContext, token: 'req_1' },
      a,
    );
    await enqueueNotification(
      'refund_requested',
      { type: 'order', id: repeatId },
      { ...repeatContext, token: 'req_1' },
      a,
    );
    await enqueueNotification(
      'refund_requested',
      { type: 'order', id: repeatId },
      { ...repeatContext, token: 'req_2' },
      a,
    );
    assert.equal((await rowsFor(a, repeatId)).length, 2, 'two distinct requests, two messages');

    /* ------------- a broken settings store is a no-op, never a thrown error */
    await a.unsafe(`drop table "${schema}".notification_channel_settings cascade`);
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args.map(String).join(' '));
    let missing = null;
    try {
      missing = await enqueueNotification(
        'payment_received',
        { type: 'order', id: `NOSTORE${suffix}` },
        { txnid: `NOSTORE${suffix}`, customerEmail: 'private@example.test' },
        a,
      );
    } finally {
      console.warn = originalWarn;
    }
    assert.equal(missing.ok, false, 'the caller sees a no-op, not an exception');
    assert.equal(missing.queued, 0);
    assert.ok(
      warnings.some((line) => line.includes('could not queue payment_received')),
      'the failure is logged by event name',
    );
    assert.ok(
      warnings.every((line) => !line.includes('private@example.test')),
      'the log never contains the recipient',
    );
  } finally {
    try {
      await dropFixtureSchema(a, schema);
    } finally {
      await a.end({ timeout: 5 });
    }
  }
});

test('no outbox row for staff or password messages carries a credential', { skip }, async () => {
  const suffix = `${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
  const schema = `itest_secret_${suffix}`;
  const a = client();
  const secrets = [
    'P@ssw0rd-SECRET-123',
    'Temp-SECRET-456',
    'tok-SECRET-789',
    'reset-SECRET-000',
  ];
  const [password, temporaryPassword, token, resetToken] = secrets;

  try {
    await createFixtureSchema(a, schema, TABLES);
    const pinned = await a`show search_path`;
    assert.ok(String(pinned[0].search_path).includes(schema), 'connection is pinned to the test schema');

    await a`delete from store_settings`;
    await a`
      insert into store_settings (key, value) values
        ('trade_name', 'Test Store'),
        ('email', 'hello@store.test'),
        ('phone', '9123456780')
    `;
    await setMatrix(a, [
      ['email', 'admin', 'staff_invite', true],
      ['sms', 'admin', 'staff_invite', true],
      ['inapp', 'admin', 'staff_invite', true],
      ['email', 'customer', 'staff_invite', true],
      ['email', 'admin', 'password_reset', true],
    ]);

    // A stored template may reference a secret-like token; unknown variables
    // are dropped, never read from the context object.
    await a`
      insert into email_templates (id, template_key, name, subject, heading, body, is_active)
      values (
        ${`tpl_${suffix}`}, 'staff_invite', 'Staff invite',
        'Account ready {{token}}', 'Welcome',
        'Password: {{password}} / {{temporary_password}} / {{reset_link}}', true
      )
    `;

    const context = {
      staffEmail: `staff-${suffix}@store.test`,
      staffPhone: '9876543210',
      staffLink: '/store-admin/login',
      token,
      password,
      temporaryPassword,
      resetToken,
      resetLink: `https://shop.example.test/reset?token=${resetToken}`,
    };

    await enqueueNotification(
      'staff_invite',
      { type: 'staff', id: `staff_${suffix}` },
      context,
      a,
    );
    await enqueueNotification(
      'password_reset',
      { type: 'staff', id: `staff_${suffix}` },
      context,
      a,
    );

    const rows = await a`
      select event_key, channel, subject, body from notification_outbox
    `;
    assert.ok(rows.length >= 4, 'the enabled cells produced rows');
    for (const row of rows) {
      const output = `${row.subject}\n${row.body}`;
      for (const secret of secrets) {
        assert.equal(
          output.includes(secret),
          false,
          `${row.event_key}/${row.channel} row leaked ${secret}`,
        );
      }
      assert.equal(output.includes('reset?token='), false);
    }
  } finally {
    try {
      await dropFixtureSchema(a, schema);
    } finally {
      await a.end({ timeout: 5 });
    }
  }
});
