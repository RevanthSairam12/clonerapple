/**
 * Standalone Order Reconciliation Worker
 * Usage: node scripts/reconcile-orders.mjs [staleMinutes]
 * 
 * Inspects orders in 'CREATED' or 'PENDING' older than 15 minutes,
 * queries PayU's Verify Payment API, and updates their status.
 */
import path from 'node:path';
import process from 'node:process';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import postgres from 'postgres';

// Load .env.local
const envPath = path.resolve(process.cwd(), '.env.local');
try {
  const env = await readFile(envPath, 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch {
  // Real environment fallback
}

const key = process.env.PAYU_KEY;
const salt = process.env.PAYU_SALT;
const envMode = process.env.PAYU_ENV === 'live' ? 'live' : 'test';
const verifyUrl = envMode === 'live'
  ? 'https://info.payu.in/merchant/postservice.php?form=2'
  : 'https://test.payu.in/merchant/postservice.php?form=2';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}
if (!key || !salt) {
  console.error('PAYU_KEY or PAYU_SALT is not configured. Reconciliation skipped.');
  process.exit(0);
}

const sql = postgres(process.env.DATABASE_URL, {
  ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require',
  onnotice: () => {},
});

const staleMinutes = parseInt(process.argv[2] || '15', 10);
console.log(`[Reconcile] Checking for orders stuck in CREATED or PENDING older than ${staleMinutes}m...`);

const staleOrders = await sql`
  SELECT * FROM orders
  WHERE status IN ('CREATED', 'PENDING')
    AND created_at <= now() - (${staleMinutes} || ' minutes')::interval
  ORDER BY created_at ASC
  LIMIT 50
`;

console.log(`[Reconcile] Found ${staleOrders.length} candidate order(s).`);

function sha512(str) {
  return createHash('sha512').update(str, 'utf8').digest('hex').toLowerCase();
}

for (const order of staleOrders) {
  try {
    const command = 'verify_payment';
    const hash = sha512(`${key}|${command}|${order.txnid}|${salt}`);

    const params = new URLSearchParams();
    params.append('key', key);
    params.append('command', command);
    params.append('var1', order.txnid);
    params.append('hash', hash);

    const res = await fetch(verifyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      console.warn(`[Reconcile] PayU returned HTTP ${res.status} for txnid=${order.txnid}`);
      continue;
    }

    const data = await res.json().catch(() => null);
    const details = data?.transaction_details?.[order.txnid];

    if (!details) {
      const ageHours = (Date.now() - new Date(order.created_at).getTime()) / (1000 * 60 * 60);
      if (ageHours >= 2) {
        await sql`
          UPDATE orders
          SET status = 'CANCELLED', updated_at = now()
          WHERE txnid = ${order.txnid} AND status != 'PAID'
        `;
        console.log(`[Reconcile] Expired abandoned order ${order.txnid} -> CANCELLED`);
      }
      continue;
    }

    const status = String(details.status || '').toLowerCase();
    const unmapped = String(details.unmappedstatus || '').toLowerCase();
    const amt = parseFloat(details.amt || details.amount || '0');
    const orderAmt = parseFloat(order.amount);

    if (status === 'success' && unmapped === 'captured' && Math.abs(amt - orderAmt) < 0.01) {
      await sql`
        UPDATE orders
        SET
          status = 'PAID',
          payu_mihpayid = ${String(details.mihpayid || '')},
          payu_mode = ${String(details.mode || '')},
          paid_at = COALESCE(paid_at, now()),
          updated_at = now()
        WHERE txnid = ${order.txnid} AND status != 'PAID'
      `;
      console.log(`[Reconcile] Confirmed & marked PAID: ${order.txnid} (mihpayid=${details.mihpayid})`);
    } else if (unmapped === 'usercancelled') {
      await sql`
        UPDATE orders SET status = 'CANCELLED', updated_at = now()
        WHERE txnid = ${order.txnid} AND status != 'PAID'
      `;
      console.log(`[Reconcile] Updated ${order.txnid} -> CANCELLED`);
    } else if (status === 'failure') {
      await sql`
        UPDATE orders SET status = 'FAILED', updated_at = now()
        WHERE txnid = ${order.txnid} AND status != 'PAID'
      `;
      console.log(`[Reconcile] Updated ${order.txnid} -> FAILED`);
    }
  } catch (err) {
    console.error(`[Reconcile] Error reconciling txnid=${order.txnid}:`, err.message);
  }
}

await sql.end();
console.log('[Reconcile] Reconciliation complete.');
