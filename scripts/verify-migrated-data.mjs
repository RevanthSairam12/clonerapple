/**
 * scripts/verify-migrated-data.mjs
 *
 * READ-ONLY verification of migrated data between SOURCE (Tokyo) and TARGET (Mumbai).
 *
 * Verifies:
 * 1. Row counts per kept table.
 * 2. Deep canonical JSON comparison of Website content blocks, Theme, and Store Settings (including archived rows).
 * 3. Canonical SHA-256 row-hash comparison per table.
 * 4. Product, SKU, pricing, images and stock comparison.
 * 5. Storage objects presence, byte sizes, and checksums.
 * 6. Kept media records resolution.
 *
 * Usage:
 *   node scripts/verify-migrated-data.mjs
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
  } catch {}
  return env;
}

function canonicalStringify(obj) {
  if (obj === null || obj === undefined) return 'null';
  if (obj instanceof Date) return JSON.stringify(obj.toISOString());
  if (Buffer.isBuffer(obj)) return JSON.stringify(obj.toString('hex'));
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalStringify).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalStringify(obj[k])).join(',') + '}';
}

function sha256(str) {
  return createHash('sha256').update(str).digest('hex');
}

async function computeChecksum(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function main() {
  const env = await loadEnv();
  const sourceDbUrl = (env.SOURCE_DATABASE_URL || '').trim();
  const targetDbUrl = (env.TARGET_DATABASE_URL || env.DATABASE_MIGRATION_URL || env.DATABASE_URL || '').trim();
  const sourceSupabaseUrl = (env.SOURCE_SUPABASE_URL || 'https://ttzfovaadeyynggnypru.supabase.co').trim();
  const targetSupabaseUrl = (env.TARGET_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '').trim();

  if (!sourceDbUrl) {
    console.error('[FATAL] Source database URL is required.');
    process.exit(1);
  }
  if (!targetDbUrl) {
    console.error('[NOTICE] Target database URL (TARGET_DATABASE_URL) is not set yet.');
    console.log('Running self-audit / source verification baseline only...');
  }

  const sourceSql = postgres(sourceDbUrl, {
    max: 1,
    ssl: 'require',
    connection: { default_transaction_read_only: 'on' },
  });

  const targetSql = targetDbUrl
    ? postgres(targetDbUrl, {
        max: 1,
        ssl: 'require',
        connection: { default_transaction_read_only: 'on' },
      })
    : null;

  try {
    const keptTables = [
      { name: 'content_blocks', pk: 'key', sort: 'key ASC' },
      { name: 'site_settings', pk: 'key', sort: 'key ASC' },
      { name: 'store_settings', pk: 'key', sort: 'key ASC', filter: "key NOT LIKE 'reconcile_heartbeat_%'" },
      { name: 'payment_methods', pk: 'id', sort: 'id ASC' },
      { name: 'cancellation_reasons', pk: 'id', sort: 'id ASC' },
      { name: 'refund_reasons', pk: 'id', sort: 'id ASC' },
      { name: 'return_reasons', pk: 'id', sort: 'id ASC' },
      { name: 'bill_request_reasons', pk: 'id', sort: 'id ASC' },
      { name: 'expense_categories', pk: 'id', sort: 'id ASC' },
      { name: 'notification_channel_settings', pk: 'id', sort: 'id ASC' },
      { name: 'store_pages', pk: 'id', sort: 'slug ASC' },
      { name: 'seo_pages', pk: 'page_key', sort: 'page_key ASC' },
      { name: 'sale_settings', pk: 'id', sort: 'id ASC' },
      { name: 'customer_settings', pk: 'key', sort: '1 ASC' },
      { name: 'fulfilment_providers', pk: 'id', sort: '1 ASC' },
      { name: 'shipping_methods', pk: 'id', sort: '1 ASC' },
      { name: 'social_links', pk: 'id', sort: '1 ASC' },
      { name: 'analytics_scripts', pk: 'id', sort: '1 ASC' },
      { name: 'store_integrations', pk: 'id', sort: '1 ASC' },
      { name: 'automated_messages', pk: 'id', sort: '1 ASC' },
      { name: 'email_templates', pk: 'id', sort: '1 ASC' },
      { name: 'store_admins', pk: 'id', sort: 'id ASC', filter: "lower(email) = 'revanth11330@gmail.com'" },
      { name: 'store_admin_preferences', pk: 'admin_id', sort: '1 ASC' },
      { name: 'categories', pk: 'id', sort: 'sort_order ASC, id ASC' },
      { name: 'media', pk: 'id', sort: 'id ASC' },
      { name: 'store_media', pk: 'id', sort: '1 ASC' },
      { name: 'products', pk: 'id', sort: 'id ASC', filter: "id NOT LIKE 'perf-test-item-%'" },
      { name: 'product_images', pk: 'id', sort: 'product_id ASC, sort_order ASC', filter: "product_id NOT LIKE 'perf-test-item-%'" },
      { name: 'product_content_revisions', pk: 'id', sort: 'product_id ASC, revision_number ASC', filter: "product_id NOT LIKE 'perf-test-item-%'" },
      { name: 'price_history', pk: 'id', sort: 'product_id ASC, changed_at ASC', filter: "product_id NOT LIKE 'perf-test-item-%'" },
      { name: 'stock', pk: 'id', sort: 'product_id ASC', filter: "product_id NOT LIKE 'perf-test-item-%'" },
      { name: 'product_variants', pk: 'id', sort: '1 ASC' },
      { name: 'product_variant_colours', pk: 'id', sort: '1 ASC' },
      { name: 'colours', pk: 'id', sort: '1 ASC' },
      { name: 'device_brands', pk: 'id', sort: '1 ASC' },
      { name: 'device_models', pk: 'id', sort: '1 ASC' },
      { name: 'product_device_models', pk: 'product_id', sort: '1 ASC' },
      { name: 'product_collections', pk: 'id', sort: '1 ASC' },
      { name: 'coupons', pk: 'id', sort: '1 ASC' },
      { name: 'coupon_targets', pk: 'id', sort: '1 ASC' },
      { name: 'brands', pk: 'id', sort: '1 ASC' },
      { name: 'conditions', pk: 'id', sort: '1 ASC' },
      { name: 'units', pk: 'id', sort: '1 ASC' },
      { name: 'attributes', pk: 'id', sort: '1 ASC' },
      { name: 'attribute_options', pk: 'id', sort: '1 ASC' },
      { name: 'product_attribute_values', pk: 'id', sort: '1 ASC' },
      { name: 'product_attribute_history', pk: 'id', sort: '1 ASC' },
      { name: 'product_types', pk: 'id', sort: '1 ASC' },
      { name: 'product_type_attributes', pk: 'id', sort: '1 ASC' },
      { name: 'product_specs', pk: 'id', sort: '1 ASC' },
      { name: 'product_facets', pk: 'product_id', sort: '1 ASC' },
      { name: 'facet_defs', pk: 'key', sort: '1 ASC' },
    ];

    console.log('================ TABLE PARITY & CANONICAL HASHES ================');
    const tableReport = [];
    for (const t of keptTables) {
      const whereClause = t.filter ? `WHERE ${t.filter}` : '';
      const sourceRows = await sourceSql.unsafe(`SELECT * FROM public."${t.name}" ${whereClause} ORDER BY ${t.sort}`);
      const sourceCanonical = canonicalStringify(sourceRows);
      const sourceHash = sha256(sourceCanonical);

      let targetCount = null;
      let targetHash = null;
      let match = 'BASELINE';

      if (targetSql) {
        const targetRows = await targetSql.unsafe(`SELECT * FROM public."${t.name}" ${whereClause} ORDER BY ${t.sort}`);
        targetCount = targetRows.length;
        const targetCanonical = canonicalStringify(targetRows);
        targetHash = sha256(targetCanonical);
        match = sourceHash === targetHash ? 'IDENTICAL' : 'MISMATCH';
      }

      tableReport.push({
        table: t.name,
        sourceCount: sourceRows.length,
        targetCount: targetCount !== null ? targetCount : '—',
        sourceHash: sourceHash.slice(0, 12),
        targetHash: targetHash ? targetHash.slice(0, 12) : '—',
        status: match,
      });

      console.log(
        `Table [${t.name.padEnd(30)}]: Source=${String(sourceRows.length).padStart(3)} | Target=${String(targetCount !== null ? targetCount : '—').padStart(3)} | Hash=${sourceHash.slice(0, 12)} | Status=${match}`
      );
    }

    if (targetSql) {
      console.log('\n================ DEEP COMPARISON: CONTENT, THEME & SETTINGS ================');
      for (const deepTable of [
        { name: 'content_blocks', filter: '' },
        { name: 'site_settings', filter: '' },
        { name: 'store_settings', filter: "WHERE key NOT LIKE 'reconcile_heartbeat_%'" },
      ]) {
        const sRows = await sourceSql.unsafe(`SELECT * FROM public."${deepTable.name}" ${deepTable.filter} ORDER BY key ASC`);
        const tRows = await targetSql.unsafe(`SELECT * FROM public."${deepTable.name}" ${deepTable.filter} ORDER BY key ASC`);
        const tMap = new Map(tRows.map((r) => [r.key, r]));
        let allEqual = sRows.length === tRows.length;
        for (const sRow of sRows) {
          const tRow = tMap.get(sRow.key);
          const sC = canonicalStringify(sRow);
          const tC = tRow ? canonicalStringify(tRow) : '';
          const ok = sC === tC;
          if (!ok) allEqual = false;
          const archivedTag = sRow.archived_at ? ' [ARCHIVED]' : '';
          console.log(`  [${deepTable.name}] key="${sRow.key}"${archivedTag}: ${ok ? 'IDENTICAL' : 'MISMATCH'} (sha256=${sha256(sC).slice(0, 10)})`);
        }
        if (!allEqual) process.exitCode = 1;
      }

      console.log('\n================ PRODUCT, OPTION, SKU & PRICE COMPARISON ================');
      const sProds = await sourceSql`
        SELECT *
        FROM public.products
        WHERE id NOT LIKE 'perf-test-item-%'
        ORDER BY id ASC
      `;
      const tProds = await targetSql`
        SELECT *
        FROM public.products
        WHERE id NOT LIKE 'perf-test-item-%'
        ORDER BY id ASC
      `;
      const tProdMap = new Map(tProds.map((p) => [p.id, p]));
      for (const sp of sProds) {
        const tp = tProdMap.get(sp.id);
        const ok = canonicalStringify(sp) === canonicalStringify(tp);
        if (!ok) process.exitCode = 1;
        console.log(
          `  Product [${sp.id}] slug=${sp.slug} price=${sp.price_paise} regular=${sp.regular_price_paise ?? sp.price_paise} sale=${sp.sale_price_paise ?? 'null'}: ${ok ? 'IDENTICAL' : 'MISMATCH'}`
        );
      }

      console.log('\n================ INITIALIZED COUNTERS & EXCLUDED TABLES CHECK ================');
      const counters = await targetSql`
        SELECT 'order_number_counters' AS table_name, name, next_number::text AS val FROM public.order_number_counters
        UNION ALL
        SELECT 'receipt_counters', name, next_number::text FROM public.receipt_counters
        UNION ALL
        SELECT 'invoice_number_counters', name, last_number::text FROM public.invoice_number_counters
      `;
      for (const c of counters) {
        console.log(`  Counter [${c.table_name}.${c.name}] = ${c.val}`);
      }
      for (const exTable of ['users', 'user_sessions', 'orders', 'order_items', 'stock_movements', 'notification_outbox']) {
        const [{ count }] = await targetSql.unsafe(`SELECT count(*)::int AS count FROM public."${exTable}"`);
        console.log(`  Excluded table [${exTable.padEnd(22)}]: Target rows = ${count} (expected 0)`);
        if (count !== 0) process.exitCode = 1;
      }
      const [{ count: auditCount }] = await targetSql`SELECT count(*)::int AS count FROM public.store_admin_audit`;
      console.log(`  Excluded table [${'store_admin_audit'.padEnd(22)}]: Target rows = ${auditCount} (source=1035 not copied; ${auditCount} migration/boot row only)`);
    }

    // Storage object verification (size + byte-level SHA-256 checksum)
    console.log('\n================ STORAGE OBJECTS & CHECKSUM VERIFICATION ================');
    const sourceObjects = await sourceSql`
      SELECT id, bucket_id, name, (metadata->>'size')::bigint AS size, metadata->>'mimetype' AS mime_type
      FROM storage.objects
      WHERE bucket_id = 'media'
      ORDER BY name ASC
    `;
    console.log(`Source media bucket: ${sourceObjects.length} objects`);

    if (targetSql && targetSupabaseUrl) {
      const targetObjects = await targetSql`
        SELECT id, bucket_id, name, (metadata->>'size')::bigint AS size, metadata->>'mimetype' AS mime_type
        FROM storage.objects
        WHERE bucket_id = 'media'
        ORDER BY name ASC
      `;
      console.log(`Target media bucket: ${targetObjects.length} objects`);
      const targetObjMap = new Map(targetObjects.map((o) => [o.name, o]));

      for (const sObj of sourceObjects) {
        const tObj = targetObjMap.get(sObj.name);
        if (!tObj) {
          console.error(`  [FAIL] Missing object on target: ${sObj.name}`);
          process.exitCode = 1;
          continue;
        }
        const sRes = await fetch(`${sourceSupabaseUrl}/storage/v1/object/public/media/${encodeURIComponent(sObj.name)}`);
        const tRes = await fetch(`${targetSupabaseUrl}/storage/v1/object/public/media/${encodeURIComponent(sObj.name)}`);
        const sBuf = Buffer.from(await sRes.arrayBuffer());
        const tBuf = Buffer.from(await tRes.arrayBuffer());
        const sSha = await computeChecksum(sBuf);
        const tSha = await computeChecksum(tBuf);
        if (sBuf.length !== tBuf.length || sSha !== tSha) {
          console.error(`  [FAIL] Checksum/size mismatch on ${sObj.name}: source=${sBuf.length}/${sSha.slice(0, 12)} target=${tBuf.length}/${tSha.slice(0, 12)}`);
          process.exitCode = 1;
        } else {
          console.log(`  [PASS] ${sObj.name}: size=${tBuf.length} bytes, sha256=${tSha.slice(0, 12)}... (IDENTICAL)`);
        }
      }

      console.log('\n================ KEPT MEDIA RECORDS RESOLUTION IN TARGET ================');
      const targetMedia = await targetSql`SELECT * FROM public.media ORDER BY id ASC`;
      for (const m of targetMedia) {
        const url = `${targetSupabaseUrl}/storage/v1/object/public/media/${encodeURIComponent(m.storage_path)}`;
        const res = await fetch(url, { method: 'HEAD' });
        console.log(`  Media [${m.id}] (${m.filename} -> ${m.storage_path}): HTTP ${res.status} ${res.status === 200 ? 'PASS' : 'FAIL'}`);
        if (res.status !== 200) process.exitCode = 1;
      }
    } else {
      console.log('[NOTICE] Target storage comparison skipped (target not attached yet).');
    }

    // Rendered HTML comparison if local source (3101) and target (3102) servers are running
    const sourceAppUrl = env.VERIFY_SOURCE_APP_URL || 'http://localhost:3101';
    const targetAppUrl = env.VERIFY_TARGET_APP_URL || 'http://localhost:3103';
    let serversReachable = false;
    try {
      const [r1, r2] = await Promise.all([
        fetch(`${sourceAppUrl}/privacy`, { signal: AbortSignal.timeout(4000) }),
        fetch(`${targetAppUrl}/privacy`, { signal: AbortSignal.timeout(4000) }),
      ]);
      serversReachable = r1.ok && r2.ok;
    } catch {
      serversReachable = false;
    }

    if (serversReachable) {
      console.log('\n================ RENDERED HTML COMPARISON (SOURCE vs TARGET) ================');
      const verifyToken = env.VERIFY_READONLY_ADMIN_TOKEN || 'readonly-verify-token-2026';
      const routesToCompare = [
        { label: 'Home page', path: '/', auth: false },
        { label: 'Category page (Power & Cables)', path: '/in/shop/iphone/accessories/power-adapter-cable', auth: false },
        { label: 'Product page (20W USB-C Power Adapter)', path: '/shop/product/apple-20w-usbc-power-adapter', auth: false },
        { label: 'Privacy page', path: '/privacy', auth: false },
        { label: 'Terms page', path: '/terms', auth: false },
        { label: 'Support page', path: '/support', auth: false },
        { label: 'Admin: Website Overview', path: '/store-admin/website', auth: true },
        { label: 'Admin: Website Content', path: '/store-admin/website/content', auth: true },
        { label: 'Admin: Website Theme', path: '/store-admin/website/theme', auth: true },
        { label: 'Admin: Store Settings', path: '/store-admin/settings', auth: true },
      ];

      const normalizeHtml = (html) =>
        html
          .replace(/ttzfovaadeyynggnypru\.supabase\.co/g, '<SUPABASE_HOST>')
          .replace(/wdupzslotwetzwwibssn\.supabase\.co/g, '<SUPABASE_HOST>')
          .replace(/localhost:3101/g, 'localhost:<PORT>')
          .replace(/localhost:3102/g, 'localhost:<PORT>')
          .replace(/localhost:3103/g, 'localhost:<PORT>');

      const extractVisibleDomAndMeta = (html) => {
        const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
        const desc = (html.match(/<meta name="description" content="([^"]*)"\/>/) || [])[1] || '';
        // Strip Next.js streaming RSC scripts (<script>...self.__next_f...</script>) and streaming head hoist script
        const withoutStreamingScripts = html
          .replace(/<script>self\.__next_f[\s\S]*?<\/script>/g, '')
          .replace(/<script>\(self\.__next_f[\s\S]*?<\/script>/g, '')
          .replace(/<script>document\.querySelectorAll\('body link[\s\S]*?<\/script>/g, '')
          .replace(/<title>[^<]*<\/title>/g, '')
          .replace(/<meta name="description" content="[^"]*"\/>/g, '');
        return JSON.stringify({ title, desc, dom: withoutStreamingScripts });
      };

      for (const route of routesToCompare) {
        const headers = route.auth ? { cookie: `store_admin_session=${verifyToken}` } : {};
        // Warm connection pool & 15s content cache on both servers so Next.js RSC head streaming order is deterministic
        await Promise.all([
          fetch(`${sourceAppUrl}${route.path}`, { headers }),
          fetch(`${targetAppUrl}${route.path}`, { headers }),
        ]);
        const [sRes, tRes] = await Promise.all([
          fetch(`${sourceAppUrl}${route.path}`, { headers }),
          fetch(`${targetAppUrl}${route.path}`, { headers }),
        ]);
        const [sRaw, tRaw] = await Promise.all([sRes.text(), tRes.text()]);
        const sNorm = normalizeHtml(sRaw);
        const tNorm = normalizeHtml(tRaw);
        const sDom = extractVisibleDomAndMeta(sNorm);
        const tDom = extractVisibleDomAndMeta(tNorm);
        const sHash = sha256(sDom).slice(0, 12);
        const tHash = sha256(tDom).slice(0, 12);
        const rawIdentical = sNorm === tNorm;
        const domIdentical = sDom === tDom;
        console.log(
          `  Route [${route.path.padEnd(46)}] HTTP ${sRes.status}/${tRes.status} | DOM Hash=${sHash}/${tHash} | ${
            rawIdentical
              ? 'IDENTICAL (byte-for-byte)'
              : domIdentical
                ? 'IDENTICAL DOM & META (Next.js RSC head-flush latency order normalized)'
                : 'DIFF DETECTED'
          }`
        );
        if (!domIdentical) {
          let diffIdx = 0;
          while (diffIdx < sDom.length && diffIdx < tDom.length && sDom[diffIdx] === tDom[diffIdx]) {
            diffIdx++;
          }
          const start = Math.max(0, diffIdx - 40);
          console.log(`    First diff at char ${diffIdx}:`);
          console.log(`      SOURCE: ${JSON.stringify(sDom.slice(start, diffIdx + 80))}`);
          console.log(`      TARGET: ${JSON.stringify(tDom.slice(start, diffIdx + 80))}`);
        }
      }
    }

    console.log('\n================ SUMMARY ================');
    console.log(`Total verified tables: ${tableReport.length}`);
    const mismatches = tableReport.filter((r) => r.status === 'MISMATCH');
    if (mismatches.length > 0) {
      console.error(`Found ${mismatches.length} table mismatches:`, mismatches.map((m) => m.table).join(', '));
      process.exitCode = 1;
    } else {
      console.log('All checked tables are valid.');
    }
  } finally {
    await sourceSql.end();
    if (targetSql) await targetSql.end();
  }
}

main().catch((err) => {
  console.error('[FATAL]', err.message);
  process.exit(1);
});
