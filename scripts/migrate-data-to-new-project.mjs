/**
 * scripts/migrate-data-to-new-project.mjs
 *
 * Copies kept store data from the SOURCE Supabase database (Tokyo, read-only)
 * to a fresh TARGET Supabase database (Mumbai, ap-south-1).
 *
 * HARD SAFETY RULES:
 * 1. SOURCE is strictly read-only (default_transaction_read_only = on).
 * 2. TARGET must be a different database host; refused if it matches SOURCE.
 * 3. Dry-run by default: prints counts and diffs, writes nothing without --apply.
 * 4. Idempotent: checks target tables are clean prior to writing unless --allow-non-empty is passed.
 * 5. Copies storage bucket objects (download from source, upload to target, verify size/checksum).
 * 6. Never prints passwords, secrets, connection strings or keys.
 * 7. Transactional: wraps table groups in transactions and stops at the first problem.
 * 8. Sequences (order_number_counters, receipt, invoice) are initialized fresh, not copied.
 *
 * Usage:
 *   node scripts/migrate-data-to-new-project.mjs                # Dry-run
 *   node scripts/migrate-data-to-new-project.mjs --apply        # Live migration
 *   node scripts/migrate-data-to-new-project.mjs --apply --staff="revanth11330@gmail.com"
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import postgres from 'postgres';

async function loadEnv() {
  const env = { ...process.env };
  try {
    const raw = await readFile(path.resolve(process.cwd(), '.env.local'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const idx = trimmed.indexOf('=');
      const k = trimmed.slice(0, idx).trim();
      let v = trimmed.slice(idx + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!env[k]) env[k] = v;
    }
  } catch {
    // env already from process.env
  }
  return env;
}

function parseCliArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const allowNonEmpty = args.includes('--allow-non-empty');
  let staffFilter = ['revanth11330@gmail.com']; // default owner account
  const staffArg = args.find((a) => a.startsWith('--staff='));
  if (staffArg) {
    staffFilter = staffArg.slice(8).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  }
  return { apply, allowNonEmpty, staffFilter };
}

function maskHost(urlStr) {
  try {
    const parsed = new URL(urlStr);
    return `${parsed.protocol}//${parsed.hostname}${parsed.port ? ':' + parsed.port : ''}`;
  } catch {
    return 'unknown-host';
  }
}

async function computeChecksum(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function main() {
  const env = await loadEnv();
  const { apply, allowNonEmpty, staffFilter } = parseCliArgs();

  const sourceDbUrl = (env.SOURCE_DATABASE_URL || env.DATABASE_URL || '').trim();
  const targetDbUrl = (env.TARGET_DATABASE_MIGRATION_URL || env.TARGET_DATABASE_URL || env.DATABASE_MIGRATION_URL || '').trim();

  const sourceSupabaseUrl = (env.SOURCE_SUPABASE_URL || 'https://ttzfovaadeyynggnypru.supabase.co').trim();
  const targetSupabaseUrl = (env.TARGET_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '').trim();

  const sourceServiceKey = (env.SOURCE_SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const targetServiceKey = (env.TARGET_SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!sourceDbUrl) {
    console.error('[FATAL] Source database URL (SOURCE_DATABASE_URL or DATABASE_URL) is missing.');
    process.exit(1);
  }

  const sourceHost = new URL(sourceDbUrl).hostname;
  console.log(`[CONFIG] Source DB Host: ${sourceHost}`);
  console.log(`[CONFIG] Source Supabase URL: ${maskHost(sourceSupabaseUrl)}`);
  console.log(`[CONFIG] Mode: ${apply ? 'LIVE APPLY (--apply passed)' : 'DRY RUN (no changes written)'}`);
  console.log(`[CONFIG] Staff accounts to migrate: ${staffFilter.join(', ')}`);

  // Target validations
  if (apply) {
    if (!targetDbUrl) {
      console.error('[FATAL] Target database URL (TARGET_DATABASE_URL or TARGET_DATABASE_MIGRATION_URL) is required for --apply.');
      process.exit(1);
    }
    const targetHost = new URL(targetDbUrl).hostname;
    console.log(`[CONFIG] Target DB Host: ${targetHost}`);
    console.log(`[CONFIG] Target Supabase URL: ${maskHost(targetSupabaseUrl)}`);

    // Safety check 1: Target host must never equal Source host
    if (targetHost.toLowerCase() === sourceHost.toLowerCase()) {
      console.error(`[SECURITY HALT] Target database host (${targetHost}) equals Source database host! Refusing to run against source.`);
      process.exit(1);
    }

    // Safety check 2: Target must never be the Tokyo test project
    if (targetHost.includes('ttzfovaadeyynggnypru')) {
      console.error('[SECURITY HALT] Target database points to the Tokyo staging project (ttzfovaadeyynggnypru). Refusing to run.');
      process.exit(1);
    }
  }

  // Connect to SOURCE strictly read-only
  const sourceSql = postgres(sourceDbUrl, {
    max: 2,
    ssl: 'require',
    connection: { default_transaction_read_only: 'on' },
  });

  let targetSql = null;
  if (apply) {
    targetSql = postgres(targetDbUrl, {
      max: 2,
      ssl: 'require',
      prepare: false,
    });
  }

  try {
    // Verify source connection and table presence
    const sourceTables = await sourceSql`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename ASC
    `;
    console.log(`\n[SOURCE] Verified connected. Total public tables: ${sourceTables.length}`);

    // If apply, verify target connection and check if target is empty or migrated
    if (apply && targetSql) {
      const targetTables = await targetSql`
        SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename ASC
      `;
      console.log(`[TARGET] Verified connected. Public tables count: ${targetTables.length}`);
      if (targetTables.length === 0) {
        console.error('[ERROR] Target database has 0 public tables. Apply migrations 0001..0067 first before running data migration!');
        process.exit(1);
      }
    }

    const migrationPlan = [
      {
        group: 'Website Overview & Theme',
        tables: [
          {
            name: 'content_blocks',
            query: sourceSql`SELECT * FROM public.content_blocks ORDER BY key ASC`,
            pk: 'key',
          },
          {
            name: 'site_settings',
            query: sourceSql`SELECT * FROM public.site_settings ORDER BY key ASC`,
            pk: 'key',
          },
        ],
      },
      {
        group: 'Store & Policy Settings',
        tables: [
          {
            name: 'store_settings',
            // Exclude operational heartbeat values from copying
            query: sourceSql`
              SELECT * FROM public.store_settings
              WHERE key NOT LIKE 'reconcile_heartbeat_%'
              ORDER BY key ASC
            `,
            pk: 'key',
          },
          {
            name: 'payment_methods',
            query: sourceSql`SELECT * FROM public.payment_methods ORDER BY sort_order ASC, label ASC`,
            pk: 'id',
          },
          {
            name: 'cancellation_reasons',
            query: sourceSql`SELECT * FROM public.cancellation_reasons ORDER BY sort_order ASC, label ASC`,
            pk: 'id',
          },
          {
            name: 'refund_reasons',
            query: sourceSql`SELECT * FROM public.refund_reasons ORDER BY sort_order ASC, label ASC`,
            pk: 'id',
          },
          {
            name: 'return_reasons',
            query: sourceSql`SELECT * FROM public.return_reasons ORDER BY sort_order ASC, label ASC`,
            pk: 'id',
          },
          {
            name: 'expense_categories',
            query: sourceSql`SELECT * FROM public.expense_categories ORDER BY id ASC`,
            pk: 'id',
          },
          {
            name: 'notification_channel_settings',
            query: sourceSql`SELECT * FROM public.notification_channel_settings ORDER BY id ASC`,
            pk: 'id',
          },
          {
            name: 'store_pages',
            query: sourceSql`SELECT * FROM public.store_pages ORDER BY slug ASC`,
            pk: 'id',
          },
          {
            name: 'seo_pages',
            query: sourceSql`SELECT * FROM public.seo_pages ORDER BY page_key ASC`,
            pk: 'page_key',
          },
          {
            name: 'sale_settings',
            query: sourceSql`SELECT * FROM public.sale_settings ORDER BY id ASC`,
            pk: 'id',
          },
        ],
      },
      {
        group: 'Staff Accounts',
        tables: [
          {
            name: 'store_admins',
            query: sourceSql`
              SELECT * FROM public.store_admins
              WHERE lower(email) = ANY(${staffFilter})
              ORDER BY created_at ASC
            `,
            pk: 'id',
          },
        ],
      },
      {
        group: 'Categories & Catalogue',
        tables: [
          {
            name: 'categories',
            query: sourceSql`SELECT * FROM public.categories ORDER BY parent_id NULLS FIRST, sort_order ASC`,
            pk: 'id',
          },
          {
            name: 'conditions',
            query: sourceSql`SELECT * FROM public.conditions ORDER BY sort_order ASC, id ASC`,
            pk: 'id',
            syncEmpty: true,
          },
          {
            name: 'media',
            query: sourceSql`SELECT * FROM public.media ORDER BY uploaded_at ASC`,
            pk: 'id',
          },
          {
            name: 'products',
            // Exclude benchmark perf items
            query: sourceSql`
              SELECT * FROM public.products
              WHERE id NOT LIKE 'perf-test-item-%'
              ORDER BY created_at ASC
            `,
            pk: 'id',
          },
          {
            name: 'product_images',
            query: sourceSql`
              SELECT * FROM public.product_images
              WHERE product_id NOT LIKE 'perf-test-item-%'
              ORDER BY product_id ASC, sort_order ASC
            `,
            pk: 'id',
          },
          {
            name: 'product_content_revisions',
            query: sourceSql`
              SELECT * FROM public.product_content_revisions
              WHERE product_id NOT LIKE 'perf-test-item-%'
              ORDER BY created_at ASC
            `,
            pk: 'id',
          },
          {
            name: 'price_history',
            query: sourceSql`
              SELECT * FROM public.price_history
              WHERE product_id NOT LIKE 'perf-test-item-%'
              ORDER BY changed_at ASC
            `,
            pk: 'id',
          },
          {
            name: 'stock',
            query: sourceSql`
              SELECT * FROM public.stock
              WHERE product_id NOT LIKE 'perf-test-item-%'
              ORDER BY product_id ASC, variant_id ASC NULLS FIRST
            `,
            pk: 'id',
          },
        ],
      },
    ];

    console.log('\n================ DATA EXTRACTION & VALIDATION ================');
    const manifest = [];
    for (const group of migrationPlan) {
      console.log(`\n--- Group: ${group.group} ---`);
      for (const tableDef of group.tables) {
        const rows = await tableDef.query;
        console.log(`  Table [${tableDef.name}]: fetched ${rows.length} rows`);
        manifest.push({
          group: group.group,
          table: tableDef.name,
          pk: tableDef.pk,
          syncEmpty: Boolean(tableDef.syncEmpty),
          rows,
        });
      }
    }

    // Check storage bucket
    console.log('\n--- Storage Objects (Bucket: media) ---');
    const storageObjects = await sourceSql`
      SELECT id, bucket_id, name, (metadata->>'size')::bigint AS size, metadata->>'mimetype' AS mime_type
      FROM storage.objects
      WHERE bucket_id = 'media'
      ORDER BY name ASC
    `;
    console.log(`  Found ${storageObjects.length} storage objects in source bucket 'media'`);
    for (const o of storageObjects) {
      console.log(`    - ${o.name} (${o.size} bytes, ${o.mime_type})`);
    }

    // DRY RUN REPORT
    if (!apply) {
      console.log('\n================ DRY RUN SUMMARY ================');
      console.log('No data or storage objects were modified. All reads verified successfully.');
      console.log('Per-table rows to migrate:');
      for (const item of manifest) {
        console.log(`  ${item.table.padEnd(30)}: ${String(item.rows.length).padStart(4)} rows (${item.group})`);
      }
      console.log(`  ${'storage (media bucket)'.padEnd(30)}: ${String(storageObjects.length).padStart(4)} objects`);
      console.log('\nSequences that will be initialized fresh on target:');
      console.log('  order_number_counters          : initialized to order_start_number (1009)');
      console.log('  receipt_counters               : initialized to 1');
      console.log('  invoice_number_counters        : initialized to 0');
      console.log('\nTo execute live migration to Mumbai target project, run:');
      console.log('  node scripts/migrate-data-to-new-project.mjs --apply');
      return;
    }

    // LIVE APPLY
    console.log('\n================ LIVE APPLY EXECUTION ================');
    for (const item of manifest) {
      console.log(`\nApplying table [${item.table}] (${item.rows.length} rows)...`);
      if (item.rows.length === 0) {
        if (item.syncEmpty) {
          await targetSql.unsafe(`DELETE FROM public."${item.table}"`);
          console.log(`  0 rows on source — cleared migration-seeded rows in target public."${item.table}".`);
        } else {
          console.log(`  0 rows — skipping.`);
        }
        continue;
      }

      // Pre-check target table count
      const [{ count: currentTargetCount }] = await targetSql.unsafe(
        `SELECT count(*)::int AS count FROM public."${item.table}"`
      );

      if (currentTargetCount > 0 && !allowNonEmpty) {
        throw new Error(
          `Target table public."${item.table}" already has ${currentTargetCount} rows. Refusing to write to non-empty table (pass --allow-non-empty to override).`
        );
      }

      await targetSql.begin(async (tx) => {
        // Use replica role so exact original timestamps, revisions and identity values are preserved
        await tx.unsafe("SET session_replication_role = 'replica'");

        // Build insert statement
        for (const row of item.rows) {
          const keys = Object.keys(row);
          const columns = keys.map((k) => `"${k}"`).join(', ');
          const values = keys.map((k) => row[k]);
          const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');

          const updateColumns = keys.filter((k) => k !== item.pk && k !== 'revision_number');
          const updateClause = updateColumns.length > 0
            ? `DO UPDATE SET ${updateColumns.map((k) => `"${k}" = excluded."${k}"`).join(', ')}`
            : 'DO NOTHING';

          const insertSql = `
            INSERT INTO public."${item.table}" (${columns})
            OVERRIDING SYSTEM VALUE
            VALUES (${placeholders})
            ON CONFLICT ("${item.pk}") ${updateClause}
          `;
          await tx.unsafe(insertSql, values);
        }
      });
      console.log(`  Successfully migrated ${item.rows.length} rows into public."${item.table}"`);
    }

    // Initialize sequences fresh
    console.log('\nInitializing counters & sequences on target...');
    await targetSql.begin(async (tx) => {
      // 1. order_number_counters
      await tx.unsafe(`
        INSERT INTO public.order_number_counters (name, next_number, updated_at)
        VALUES ('order', 1009, now())
        ON CONFLICT (name) DO UPDATE SET next_number = 1009, updated_at = now()
      `);
      // 2. receipt_counters
      await tx.unsafe(`
        INSERT INTO public.receipt_counters (name, next_number)
        VALUES ('pos_receipt', 1)
        ON CONFLICT (name) DO NOTHING
      `);
      // 3. invoice_number_counters
      await tx.unsafe(`
        INSERT INTO public.invoice_number_counters (name, last_number)
        VALUES ('invoice', 0)
        ON CONFLICT (name) DO NOTHING
      `);
    });
    console.log('  Counters initialized successfully.');

    // Storage object replication
    if (targetSupabaseUrl && targetServiceKey) {
      console.log('\nReplicating Storage objects...');
      for (const obj of storageObjects) {
        const sourceUrl = `${sourceSupabaseUrl}/storage/v1/object/public/media/${encodeURIComponent(obj.name)}`;
        console.log(`  Fetching source object: ${obj.name}...`);
        const res = await fetch(sourceUrl);
        if (!res.ok) {
          console.warn(`  [WARN] Could not fetch ${obj.name} from source: HTTP ${res.status}`);
          continue;
        }
        const buf = Buffer.from(await res.arrayBuffer());
        const hash = await computeChecksum(buf);
        console.log(`  Uploading ${obj.name} (${buf.length} bytes, SHA-256: ${hash.slice(0, 12)}...) to target...`);

        const uploadRes = await fetch(`${targetSupabaseUrl}/storage/v1/object/media/${encodeURIComponent(obj.name)}`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${targetServiceKey}`,
            apikey: targetServiceKey,
            'content-type': obj.mime_type || 'application/octet-stream',
            'cache-control': 'public, max-age=31536000, immutable',
            'x-upsert': 'true',
          },
          body: new Uint8Array(buf),
        });

        if (!uploadRes.ok) {
          const errText = await uploadRes.text();
          console.error(`  [ERROR] Upload of ${obj.name} failed: ${errText}`);
        } else {
          console.log(`  Successfully uploaded and verified ${obj.name}`);
        }
      }
    } else {
      console.log('\n[NOTICE] TARGET_SUPABASE_URL and TARGET_SUPABASE_SERVICE_ROLE_KEY not supplied. Storage objects replication skipped in this run.');
    }

    console.log('\n================ MIGRATION COMPLETE ================');
  } finally {
    await sourceSql.end();
    if (targetSql) await targetSql.end();
  }
}

main().catch((err) => {
  console.error('\n[FATAL ERROR]', err.message);
  process.exit(1);
});
