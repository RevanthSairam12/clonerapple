import postgres from 'postgres';

async function test() {
  console.log('Testing DATABASE_URL (port 6543)...');
  const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5 });
  try {
    const res = await sql`select 1 as x`;
    console.log('DATABASE_URL ok:', res);
  } catch (e) {
    console.log('DATABASE_URL error:', e.message);
  } finally {
    await sql.end({ timeout: 1 });
  }

  console.log('Testing DATABASE_MIGRATION_URL (port 5432)...');
  const sqlMig = postgres(process.env.DATABASE_MIGRATION_URL, { max: 1, connect_timeout: 5 });
  try {
    const res = await sqlMig`select 1 as x`;
    console.log('DATABASE_MIGRATION_URL ok:', res);
  } catch (e) {
    console.log('DATABASE_MIGRATION_URL error:', e.message);
  } finally {
    await sqlMig.end({ timeout: 1 });
  }
}
test().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
