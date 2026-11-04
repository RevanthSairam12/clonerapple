import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import postgres from 'postgres';
import bcrypt from 'bcryptjs';
import path from 'node:path';
import { createJiti } from 'jiti';
import { loadEnv, skipReason } from './helpers/reports-fixture.mjs';
import { createFixtureSchema, dropFixtureSchema } from './helpers/isolated-schema.mjs';
await loadEnv();
const jiti = createJiti(import.meta.url, { alias: { '@': path.resolve('src') } });
const staff = await jiti.import('../src/lib/store-admin/staff.ts');
const { getStoreSessionForToken } = await jiti.import('../src/lib/store-admin/auth.ts');

test('real staff removal frees email, revokes sessions and preserves immutable history', { skip: skipReason() }, async () => {
  const schema = `itest_staff_${randomBytes(8).toString('hex')}`;
  const sql = postgres(process.env.DATABASE_URL, {
    max: 1,
    ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require',
    prepare: false,
    connection: { search_path: 'pg_catalog' },
    onnotice: () => {},
  });
  try {
    await createFixtureSchema(sql, schema, [
      'store_admins', 'store_admin_sessions', 'store_admin_preferences', 'store_admin_audit',
    ]);
    await sql.unsafe(`alter table store_admin_sessions add foreign key (admin_id) references store_admins(id)`);
    await sql.unsafe(`create trigger immutable before update or delete on store_admin_audit for each row execute function public.forbid_audit_mutation()`);
    const hash = await bcrypt.hash('temporary-123', 4);
    await sql`insert into store_admins (id,email,name,password_hash,role) values
      ('owner','owner@example.test','Owner',${hash},'store_owner'),
      ('staff','reusable@example.test','Fixture Staff',${hash},'store_admin')`;
    const tokenHash = createHash('sha256').update('fixture-token').digest('hex');
    await sql`insert into store_admin_sessions(token_hash,admin_id,expires_at) values (${tokenHash},'staff',now()+interval '1 day')`;
    assert.equal((await getStoreSessionForToken('fixture-token')).adminId, 'staff');
    const audit = { actorId: 'owner', actorEmail: 'owner@example.test', action: 'staff.remove', entity: 'store_admin' };
    assert.equal((await staff.removeStaff('staff', 'wrong@example.test', audit)).ok, false);
    assert.equal((await sql`select count(*)::int n from store_admin_sessions`)[0].n, 1);
    const removed = await staff.removeStaff('staff', 'reusable@example.test', audit);
    assert.equal(removed.ok, true);
    assert.equal(removed.data.sessionsRevoked, 1);
    assert.equal(await getStoreSessionForToken('fixture-token'), null);
    assert.equal((await staff.getStaff('staff')).ok, false);
    assert.equal((await staff.listStaff()).data.length, 1);
    const tombstone = (await sql`select * from store_admins where id='staff'`)[0];
    assert.equal(tombstone.name, 'Removed staff member');
    assert.notEqual(tombstone.email, 'reusable@example.test');
    assert.equal(tombstone.phone, null);
    assert.equal(tombstone.is_active, false);
    await sql`insert into store_admins(id,email,password_hash) values ('replacement','reusable@example.test',${hash})`;
    const history = await sql`select action from store_admin_audit`;
    assert.equal(history[0].action, 'staff.remove');
    await assert.rejects(sql`update store_admin_audit set reason='changed'`, /immutable/);

    await sql`update store_admins set must_change_password=true where id='replacement'`;
    await sql`insert into store_admin_sessions(token_hash,admin_id,expires_at) values
      ('keep','replacement',now()+interval '1 day'), ('other','replacement',now()+interval '1 day')`;
    const changed = await staff.changeOwnPassword({ adminId: 'replacement', currentTokenHash: 'keep',
      currentPassword: 'temporary-123', newPassword: 'changed-456', confirmPassword: 'changed-456',
      audit: { actorId: 'replacement', action: 'profile.password_change', entity: 'store_admin' } });
    assert.equal(changed.ok, true);
    assert.equal(changed.data.sessionsRevoked, 1);
    assert.deepEqual((await sql`select token_hash from store_admin_sessions`).map(r => r.token_hash), ['keep']);
    const account = (await sql`select password_hash,must_change_password from store_admins where id='replacement'`)[0];
    assert.equal(account.must_change_password, false);
    assert.equal(await bcrypt.compare('changed-456', account.password_hash), true);
  } finally {
    try {
      await dropFixtureSchema(sql, schema);
    } finally {
      await sql.end({ timeout: 5 });
    }
  }
});
