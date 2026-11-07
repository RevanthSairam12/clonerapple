/**
 * Live proof of the outbox worker's two hard guarantees:
 * - two workers never deliver the same row;
 * - retry stops at the attempt cap and a permanent failure is not retried.
 *
 * The worker's provider seam is replaced with a recording function, so no
 * network call is made. Everything else — the FOR UPDATE SKIP LOCKED claim,
 * the lease, status transitions and the masked delivery log — is the real SQL.
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

function fixtureConnectionUrl() {
  return (process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL || '').trim();
}

function connectionDetails() {
  const url = new URL(fixtureConnectionUrl());
  return {
    transactionPooler: url.port === '6543',
  };
}

const skip = process.env.RUN_LEGACY_DB_TESTS !== '1'
  ? 'legacy database tests require explicit RUN_LEGACY_DB_TESTS=1 approval'
  : !fixtureConnectionUrl()
  ? 'DATABASE_MIGRATION_URL / DATABASE_URL is not set'
  : connectionDetails().transactionPooler
    ? 'temporary-schema isolation needs a session connection (not port 6543)'
    : false;

function client(schema = 'pg_catalog') {
  if (process.env.RUN_LEGACY_DB_TESTS !== '1') throw new Error('Legacy database tests are disabled');
  if (connectionDetails().transactionPooler) throw new Error('Requires a session connection, not port 6543.');
  return postgres(fixtureConnectionUrl(), {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    max_lifetime: 1800,
    ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require',
    prepare: false,
    connection: { search_path: schema },
    onnotice: () => {},
  });
}

const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { '@': path.join(here, '..', 'src') },
});
const {
  claimNotificationBatch,
  getNotificationDeliveryLog,
  processNotificationOutbox,
  retryNotification,
  scrubOldNotifications,
} = await jiti.import(
  path.join(here, '..', 'src', 'lib', 'notifications', 'outbox.ts'),
);

let sequence = 0;

async function insertRow(sql, overrides = {}) {
  sequence += 1;
  const row = {
    id: `ntf_itest_${sequence}_${randomBytes(3).toString('hex')}`,
    event_key: 'order_placed',
    audience: 'customer',
    channel: 'email',
    entity_type: 'order',
    entity_id: `ITEST${sequence}`,
    recipient: 'buyer@example.test',
    recipient_masked: 'b***@example.test',
    subject: 'Subject',
    body: '<p>Body</p>',
    status: 'QUEUED',
    reason: '',
    attempts: 0,
    // A minute in the past so a small client/server clock difference can never
    // hide a row from `next_attempt_at <= now()`. Production rows use the
    // database default instead of a client timestamp.
    next_attempt_at: new Date(Date.now() - 60_000),
    sent_at: null,
    dedupe_key: `itest:${sequence}:${randomBytes(4).toString('hex')}`,
    ...overrides,
  };
  await sql`
    insert into notification_outbox (
      id, event_key, audience, channel, entity_type, entity_id,
      recipient, recipient_masked, subject, body, status, reason,
      attempts, next_attempt_at, sent_at, dedupe_key
    ) values (
      ${row.id}, ${row.event_key}, ${row.audience}, ${row.channel},
      ${row.entity_type}, ${row.entity_id}, ${row.recipient}, ${row.recipient_masked},
      ${row.subject}, ${row.body}, ${row.status}, ${row.reason}, ${row.attempts},
      ${row.next_attempt_at}, ${row.sent_at}, ${row.dedupe_key}
    )
  `;
  return row;
}

async function statusOf(sql, id) {
  const rows = await sql`
    select status, reason, attempts, sent_at, next_attempt_at
    from notification_outbox where id = ${id}
  `;
  return rows[0];
}

test('the outbox worker claims exclusively, retries with backoff, and stops', { skip }, async () => {
  const suffix = `${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
  const schema = `itest_outbox_${suffix}`;
  const a = client();
  const b = client(schema);

  try {
    await createFixtureSchema(a, schema, ['notification_outbox']);
    await b.unsafe(`set search_path to "${schema}"`);
    const pinned = await a`show search_path`;
    assert.ok(String(pinned[0].search_path).includes(schema), 'connection A is pinned to the test schema');
    const pinnedB = await b`show search_path`;
    assert.ok(String(pinnedB[0].search_path).includes(schema), 'connection B is pinned to the test schema');

    /* ------------------------------------ two claims never take the same row */
    for (let index = 0; index < 6; index += 1) {
      await insertRow(a, { entity_id: `CLAIM${index}${suffix}` });
    }
    const [claimA, claimB] = await Promise.all([
      claimNotificationBatch(a, 10),
      claimNotificationBatch(b, 10),
    ]);
    const claimedIds = [...claimA, ...claimB].map((row) => row.id);
    assert.equal(claimedIds.length, 6, 'all six due rows were claimed');
    assert.equal(new Set(claimedIds).size, 6, 'no row was handed to both workers');
    assert.equal(claimA.length + claimB.length, 6);
    const leased = await a`select status from notification_outbox`;
    assert.ok(leased.every((row) => row.status === 'SENDING'));

    /* ------------------------------------------- worker status transitions */
    await a`delete from notification_outbox`;
    const email = await insertRow(a, { entity_id: `EMAIL${suffix}` });
    const sms = await insertRow(a, {
      entity_id: `SMS${suffix}`,
      channel: 'sms',
      recipient: '9876543210',
      recipient_masked: '98******10',
      body: 'SMS body',
    });
    const staffInapp = await insertRow(a, {
      entity_id: `STAFF${suffix}`,
      channel: 'inapp',
      audience: 'staff',
      recipient: 'staff',
      recipient_masked: 'staff',
    });
    const customerInapp = await insertRow(a, {
      entity_id: `CUSTOMER${suffix}`,
      channel: 'inapp',
      audience: 'customer',
      recipient: 'customer',
      recipient_masked: 'customer',
    });

    const calls = [];
    const deliver = async (input) => {
      calls.push(input);
      if (input.channel === 'sms') {
        return { outcome: 'SKIPPED', reason: 'sms not configured (test)', permanent: false };
      }
      return { outcome: 'SENT', reason: '', permanent: false };
    };

    const processed = await processNotificationOutbox(10, { sql: a, deliver });
    assert.equal(processed.ok, true);
    assert.deepEqual(
      {
        claimed: processed.claimed,
        sent: processed.sent,
        skipped: processed.skipped,
        retried: processed.retried,
        failed: processed.failed,
      },
      { claimed: 4, sent: 2, skipped: 2, retried: 0, failed: 0 },
    );
    assert.equal(calls.length, 2, 'in-app rows never reach a provider');
    assert.deepEqual(calls.map((call) => call.channel).sort(), ['email', 'sms']);
    assert.equal((await statusOf(a, email.id)).status, 'SENT');
    assert.equal((await statusOf(a, staffInapp.id)).status, 'SENT');
    assert.equal((await statusOf(a, sms.id)).status, 'SKIPPED');
    assert.match((await statusOf(a, sms.id)).reason, /sms not configured/);
    assert.equal((await statusOf(a, customerInapp.id)).status, 'SKIPPED');
    assert.match((await statusOf(a, customerInapp.id)).reason, /no customer in-app inbox/);
    assert.equal((await statusOf(a, email.id)).attempts, 1);
    assert.ok((await statusOf(a, email.id)).sent_at);

    /* ------------------------------------------ retry, backoff and the cap */
    await a`delete from notification_outbox`;
    const retrying = await insertRow(a, { entity_id: `RETRY${suffix}` });
    const retryPass = await processNotificationOutbox(10, {
      sql: a,
      deliver: async () => ({ outcome: 'FAILED', reason: 'provider down', permanent: false }),
    });
    assert.equal(retryPass.retried, 1);
    const retryRow = await statusOf(a, retrying.id);
    assert.equal(retryRow.status, 'QUEUED');
    assert.equal(retryRow.attempts, 1);
    assert.match(retryRow.reason, /provider down/);
    const delayMs = new Date(retryRow.next_attempt_at).getTime() - Date.now();
    assert.ok(delayMs > 30_000, `backoff should be at least a minute, was ${delayMs}ms`);

    await a`update notification_outbox set next_attempt_at = now() where id = ${retrying.id}`;
    const capped = await insertRow(a, { entity_id: `CAP${suffix}`, attempts: 4 });
    const capPass = await processNotificationOutbox(10, {
      sql: a,
      deliver: async () => ({ outcome: 'FAILED', reason: 'still down', permanent: false }),
    });
    assert.equal(capPass.failed, 1, 'the fifth attempt is terminal');
    const cappedRow = await statusOf(a, capped.id);
    assert.equal(cappedRow.status, 'FAILED');
    assert.equal(cappedRow.attempts, 5);
    assert.match(cappedRow.reason, /stopped after 5 attempts/);

    const permanent = await insertRow(a, { entity_id: `PERM${suffix}` });
    const permanentPass = await processNotificationOutbox(10, {
      sql: a,
      deliver: async () => ({ outcome: 'FAILED', reason: 'invalid phone recipient', permanent: true }),
    });
    assert.equal(permanentPass.failed, 1);
    assert.equal((await statusOf(a, permanent.id)).status, 'FAILED');
    assert.equal((await statusOf(a, permanent.id)).attempts, 1);

    /* ------------------------ two workers, no duplicate provider delivery */
    await a`delete from notification_outbox`;
    for (let index = 0; index < 4; index += 1) {
      await insertRow(a, {
        entity_id: `PARALLEL${index}${suffix}`,
        recipient: `parallel-${index}@example.test`,
      });
    }
    const parallelCalls = [];
    const parallelDeliver = async (input) => {
      parallelCalls.push(input.recipient);
      await new Promise((resolve) => setTimeout(resolve, 40));
      return { outcome: 'SENT', reason: '', permanent: false };
    };
    await Promise.all([
      processNotificationOutbox(10, { sql: a, deliver: parallelDeliver }),
      processNotificationOutbox(10, { sql: b, deliver: parallelDeliver }),
    ]);
    assert.equal(parallelCalls.length, 4, 'every row was delivered exactly once');
    assert.equal(new Set(parallelCalls).size, 4);
    const parallelRows = await a`select status, attempts from notification_outbox`;
    assert.ok(parallelRows.every((row) => row.status === 'SENT' && Number(row.attempts) === 1));

    /* ------------------------------- the admin log is masked and retryable */
    await a`delete from notification_outbox`;
    const failed = await insertRow(a, {
      entity_id: `LOGFAIL${suffix}`,
      status: 'FAILED',
      attempts: 5,
      reason: 'mail server rejected the message',
      recipient: 'veryprivate@example.test',
      recipient_masked: 'v***@example.test',
      subject: 'Private subject',
      body: '<p>Private body</p>',
    });
    const sent = await insertRow(a, {
      entity_id: `LOGSENT${suffix}`,
      status: 'SENT',
      attempts: 1,
      sent_at: new Date(),
      recipient: 'another-private@example.test',
      recipient_masked: 'a***@example.test',
    });

    const log = await getNotificationDeliveryLog({ sql: a });
    assert.equal(log.ok, true);
    assert.equal(log.counts.FAILED, 1);
    assert.equal(log.counts.SENT, 1);
    assert.equal(log.rows.length, 2);
    for (const row of log.rows) {
      assert.equal('recipient' in row, false, 'the full recipient never leaves the database');
      assert.equal('body' in row, false, 'the body never reaches the log');
      assert.equal('subject' in row, false);
      assert.match(row.recipientMasked, /\*\*\*/);
    }

    const onlyFailed = await getNotificationDeliveryLog({ sql: a, status: 'FAILED' });
    assert.equal(onlyFailed.rows.length, 1);
    assert.equal(onlyFailed.rows[0].id, failed.id);

    const retried = await retryNotification(failed.id, a);
    assert.equal(retried.ok, true);
    const retriedRow = await statusOf(a, failed.id);
    assert.equal(retriedRow.status, 'QUEUED');
    assert.equal(retriedRow.attempts, 0);
    assert.equal(retriedRow.reason, '');

    const cannotRetrySent = await retryNotification(sent.id, a);
    assert.equal(cannotRetrySent.ok, false);
  } finally {
    try {
      await dropFixtureSchema(a, schema);
    } finally {
      await Promise.all([a.end({ timeout: 5 }), b.end({ timeout: 5 })]);
    }
  }
});

test('retention clears old finished bodies but keeps the audit trail', { skip }, async () => {
  const suffix = `${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
  const schema = `itest_retention_${suffix}`;
  const a = client();

  try {
    await createFixtureSchema(a, schema, ['notification_outbox']);
    const pinned = await a`show search_path`;
    assert.ok(String(pinned[0].search_path).includes(schema), 'connection is pinned to the test schema');

    const now = new Date('2026-10-26T12:00:00.000Z');
    const oldSent = await insertRow(a, { status: 'SENT', sent_at: new Date('2026-05-01T00:00:00.000Z') });
    const oldFailed = await insertRow(a, { status: 'FAILED', reason: 'mail server rejected the message' });
    const oldQueued = await insertRow(a, { status: 'QUEUED', next_attempt_at: new Date('2026-05-01T00:00:00.000Z') });
    const recentSent = await insertRow(a, { status: 'SENT', sent_at: new Date('2026-10-20T00:00:00.000Z') });

    await a`update notification_outbox set created_at = '2026-05-01T00:00:00Z' where id in (${oldSent.id}, ${oldFailed.id}, ${oldQueued.id})`;
    await a`update notification_outbox set created_at = '2026-10-20T00:00:00Z' where id = ${recentSent.id}`;

    // Off by default: nothing is touched without the switch.
    const disabled = await scrubOldNotifications({ sql: a, env: {}, now });
    assert.deepEqual(disabled, { enabled: false, days: null, scrubbed: 0 });

    const result = await scrubOldNotifications({
      sql: a,
      env: { NOTIFICATION_RETENTION_ENABLED: 'on', NOTIFICATION_RETENTION_DAYS: '90' },
      now,
    });
    assert.deepEqual(result, { enabled: true, days: 90, scrubbed: 2 });

    const rows = await a`
      select id, recipient, recipient_masked, subject, body, status, reason, created_at
      from notification_outbox order by id
    `;
    const byId = new Map(rows.map((row) => [String(row.id), row]));

    for (const id of [oldSent.id, oldFailed.id]) {
      const row = byId.get(id);
      assert.equal(String(row.body), '', 'old finished body is cleared');
      assert.equal(String(row.recipient), '', 'old finished recipient is cleared');
      assert.ok(String(row.recipient_masked).includes('@'), 'the masked recipient stays');
      assert.equal(String(row.subject), 'Subject', 'the subject stays');
      assert.ok(row.created_at instanceof Date, 'the timestamp stays');
    }
    assert.equal(String(byId.get(oldFailed.id).status), 'FAILED');
    assert.equal(String(byId.get(oldFailed.id).reason), 'mail server rejected the message');

    // A row still waiting to send is never stripped, and a recent row is kept.
    for (const id of [oldQueued.id, recentSent.id]) {
      const row = byId.get(id);
      assert.equal(String(row.body), '<p>Body</p>');
      assert.equal(String(row.recipient), 'buyer@example.test');
    }

    // Running again changes nothing.
    const again = await scrubOldNotifications({
      sql: a,
      env: { NOTIFICATION_RETENTION_ENABLED: 'on', NOTIFICATION_RETENTION_DAYS: '90' },
      now,
    });
    assert.equal(again.scrubbed, 0);
  } finally {
    try {
      await dropFixtureSchema(a, schema);
    } finally {
      await a.end({ timeout: 5 });
    }
  }
});
