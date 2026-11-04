/** Read-only Phase 5 census. Never applies migrations or prints recipient data. */
import fs from 'node:fs';
import postgres from 'postgres';
let sql;
try {
  const env = {};
  if (fs.existsSync('.env.local')) {
    for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*(DATABASE_URL|DATABASE_SSL)\s*=\s*(.*?)\s*$/);
      if (match) env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  const connection = process.env.DATABASE_URL || env.DATABASE_URL;
  if (!connection) throw new Error('configuration');
  const hostname = new URL(connection).hostname;
  sql = postgres(connection, {
    max: 1, prepare: false, connect_timeout: 10, idle_timeout: 5,
    ssl: (process.env.DATABASE_SSL || env.DATABASE_SSL) === 'false' ? undefined : 'require',
    onnotice: () => {},
    connection: { default_transaction_read_only: 'on', search_path: 'public', statement_timeout: 20000, lock_timeout: 3000 },
  });
  const report = await sql.begin('isolation level repeatable read read only', async tx => {
    const [state] = await tx`show transaction_read_only`;
    if (state.transaction_read_only !== 'on') throw new Error('readonly');
    const columns = await tx`select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'coupons'
      and column_name in ('show_to_all_users', 'assigned_to_emails', 'assigned_customer_groups')`;
    const [counts] = await tx`select count(*)::int as existing_coupons from coupons`;
    const installed = columns.some(row => row.column_name === 'show_to_all_users');
    const visible = installed ? (await tx`select count(*)::int as count from coupons where show_to_all_users`)[0].count : 0;
    return { hostname, mode: 'read-only', migration: '0053_coupon_visibility_assignments.sql',
      installedColumns: columns.map(row => row.column_name).sort(),
      existingCoupons: counts.existing_coupons,
      existingCouponsReceivingHiddenDefault: installed ? 0 : counts.existing_coupons,
      currentlyPublic: visible, proposedBusinessRowWrites: 0,
      note: installed ? 'Rerun preserves current choices.' : 'First installation defaults all existing coupons hidden; no assignments are inferred.' };
  });
  console.log(JSON.stringify(report, null, 2));
} catch {
  console.error('Read-only coupon census failed; no writes attempted. Connection/error details withheld.');
  process.exitCode = 1;
} finally {
  if (sql) await sql.end({ timeout: 5 });
}
