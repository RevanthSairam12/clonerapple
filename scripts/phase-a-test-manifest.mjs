/** Read-only Phase A preapproval. Never imports postgres or opens a connection. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, phase2Manifest } from '../tests/helpers/phase2-fixture.mjs';
import { SHIPPING_CHECKOUT_TABLES } from '../tests/helpers/shipping-order-fixture.mjs';

try {
  let target = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
  if (!target && process.argv.includes('--configured-hostname')) {
    const text = await readFile(path.join(ROOT, '.env.local'), 'utf8');
    target = text.match(/^\s*(?:DATABASE_MIGRATION_URL|DATABASE_URL)\s*=\s*(.*?)\s*$/m)?.[1]?.replace(/^(['"])(.*)\1$/, '$2');
  }
  if (!target) throw new Error('Missing target');
  const url = new URL(target);
  if (url.port === '6543') throw new Error('Transaction pooler unsupported');
  const phase2 = await phase2Manifest(target);
  const shippingTables = [...SHIPPING_CHECKOUT_TABLES, 'users'];
  const callbacks = ['categories','products','stock','stock_movements','orders','order_items','order_addresses','order_status_history','store_settings','coupons','coupon_targets','coupon_redemptions','refund_obligations','payment_events'];
  const counts = (tables, nonzero) => Object.fromEntries(tables.map(name => [name, nonzero[name] ?? 0]));
  const sourceFiles = [
    'scripts/phase-a-test-manifest.mjs',
    'tests/phase2-documents-integration.test.mjs','tests/helpers/phase2-fixture.mjs',
    'tests/shipping-order-integration.test.mjs','tests/helpers/shipping-order-fixture.mjs',
    'tests/payu-callback-integration.test.mjs','tests/helpers/isolated-schema.mjs',
    'src/lib/orders/document-policy.ts','src/lib/orders/document-data.ts','src/lib/account/bill-requests.ts','src/lib/orders/invoice.ts',
    'src/lib/payu/orders.ts','src/lib/payu/stock.ts','src/lib/payu/process-response.ts','src/lib/payu/verify.ts','src/lib/payu/reconcile.ts','src/lib/payu/payment-events.ts',
    'src/lib/checkout/shipping-rules.ts','src/lib/checkout/stock-rules.ts','src/lib/checkout/settings.ts','src/lib/payu/db-pricing.ts','src/lib/payu/db-catalog.ts',
    'migrations/0047_payment_events.sql','migrations/0049_order_documents.sql','migrations/0050_refund_lifecycle.sql',
  ];
  const sourceSha256 = Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, createHash('sha256').update(await readFile(path.join(ROOT, file))).digest('hex')])));
  const manifest = {
    version: 1, hostname: url.hostname, maximumConnections: 2,
    execution: 'Run suites separately, sequentially; phase2 normally max:1, max:2 only deliberate races; shipping/callback max:1 each. No app server or other DB suites concurrently.',
    approval: 'Preapproval only, not authorization to execute. Ask for fresh approval of this exact source digest; do not reuse old approvals. Sources must remain unchanged before execution.',
    publicBusinessDataReads: 0, publicTableWrites: 0, publicSequenceAdvances: 0,
    publicMetadataReads: 'shipping/callback copy empty public table definitions with LIKE INCLUDING ALL and inspect information_schema; never copy business rows',
    cleanup: 'Each suite drops only a schema it successfully created, in finally/after; never adopt or replace an existing schema. Stop after incomplete cleanup or any suite failure.',
    effects: 'No provider, email, notification delivery, cache or app pool. Callback verifier is injected and sideEffects:false. Fake gateway credentials exist only inside callback process.',
    suites: [
      { name:'phase2-documents', testFile:'tests/phase2-documents-integration.test.mjs', manifest:phase2 },
      {
        name:'shipping-order',testFile:'tests/shipping-order-integration.test.mjs',schema:'itest_shipping_<fresh timestamp+random suffix>',maximumConnections:1,
        fixtureTables:shippingTables,
        committedInsertOperations:counts(shippingTables,{categories:9,products:9,product_images:9,stock:9,sale_settings:1,store_settings:5,orders:9,order_items:9,order_addresses:9,order_status_history:9,stock_movements:9,coupons:2,coupon_redemptions:2}),
        committedUpdateRowOperations:{store_settings:34,sale_settings:8,products:6,stock:9},
        committedDeleteRows:counts(shippingTables,{categories:8,products:8,product_images:8,stock:8,orders:8,order_items:8,order_addresses:8,order_status_history:8,stock_movements:8,coupons:2,coupon_redemptions:2}),
        finalRows:counts(shippingTables,{categories:1,products:1,product_images:1,stock:1,sale_settings:1,store_settings:5,orders:1,order_items:1,order_addresses:1,order_status_history:1,stock_movements:1}),
        rolledBackInsertOperations:0,
        sequences:{policy:'Discover every copied serial default and rebind to schema-local fixture_serial_<index>_seq before inserts; copied identity sequences are schema-local. Never use public defaults.',expectedAdvancesByTable:{stock_movements:9,order_items:9,order_addresses:9,order_status_history:9,coupon_redemptions:2},expectedTotal:38},
        coverage:'Authoritative shipping threshold, rejected changed total, sale-price re-quote, coupon order totals, immutable historical shipping; all six registrations, no test-name filtering.',
      },
      {
        name:'payu-callback',testFile:'tests/payu-callback-integration.test.mjs',schema:'itest_payu_<fresh 20 random hex characters>',maximumConnections:1,
        fixtureTables:callbacks,
        committedInsertOperations:counts(callbacks,{categories:1,products:1,stock:1,orders:5,order_items:5,order_addresses:5,order_status_history:10,stock_movements:7,store_settings:2,payment_events:10}),
        committedUpdateRowOperations:{orders:8,stock:7},committedDeleteRows:0,
        rejectedMutationAttempts:{payment_events:2},
        rolledBackInsertOperations:0,
        sequences:{policy:'Copied serial defaults rebound to schema-local fixture_serial_<index>_seq; migration creates local payment_events_id_seq after pinned search_path.',expectedAdvancesByTable:{order_items:5,order_addresses:5,order_status_history:10,stock_movements:7,payment_events:10},expectedTotal:37},
        coverage:'Real row-locked settlement with duplicate callbacks, failure then late capture, gateway identity replay rejection, amount mismatch and append-only timeline; all four registrations, injected verifier only.',
      },
    ],
    countSemantics:'Shipping/callback counts are source-derived expected committed row operations, not observed DB results. Upserts count existing rows as updates. Recalculate and reapprove if sources change. Phase2 has separate rejected/rolled-back audit inserts and a strict final-row assertion.',
    sourceSha256,
  };
  console.log(JSON.stringify({...manifest,approvalSha256:createHash('sha256').update(JSON.stringify(manifest)).digest('hex')},null,2));
} catch {
  console.error('Cannot prepare Phase A approval scope. Configuration details withheld; no database connection was made.');
  process.exitCode = 1;
}
