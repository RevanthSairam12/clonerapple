/**
 * One-time cleanup after the waiting list was removed.
 *
 * Returns every unit still held by a waiting-list invitation to availability and
 * writes one audit row when anything moved. Safe to run repeatedly: the routine
 * only touches `status = 'HELD'` rows, so a second run reports zero.
 *
 * Usage: node scripts/release-waitlist-holds.mjs
 *
 * Prints counts only — never a key or connection string.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createJiti } from 'jiti';

const root = process.cwd();

if (!process.env.DATABASE_URL) {
  try {
    const env = await readFile(path.join(root, '.env.local'), 'utf8');
    for (const line of env.split('\n')) {
      const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
  } catch {
    // DATABASE_URL must come from the environment then.
  }
}

const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  alias: { '@': path.join(root, 'src') },
});

const { getSql } = await jiti.import(path.join(root, 'src/lib/admin/db.ts'));
const { releaseWaitingListHoldsUsing } = await jiti.import(
  path.join(root, 'src/lib/payu/waitlist-cleanup.ts'),
);
const { writeAudit } = await jiti.import(path.join(root, 'src/lib/store-admin/audit.ts'));

const sql = getSql();
if (!sql) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

try {
  const summary = await releaseWaitingListHoldsUsing(sql);
  console.log(
    `held reservations released: ${summary.holdsReleased}; units returned: ${summary.unitsReleased}`,
  );
  if (summary.products.length > 0) {
    console.log(`products touched: ${summary.products.join(', ')}`);
  }

  if (summary.holdsReleased > 0) {
    await writeAudit({
      action: 'catalog.waitlist.release_holds',
      entity: 'stock_reservations',
      status: 'ok',
      reason: 'waiting list removed; held units returned to availability',
      after: summary,
      route: 'scripts/release-waitlist-holds',
    });
  }
} finally {
  await sql.end({ timeout: 5 });
}
