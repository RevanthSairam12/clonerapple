/** Read-only retirement gate. Prints counts/statuses, never stored URLs or credentials. */
import postgres from 'postgres';
import { loopbackBase, checkMediaRoutes } from './lib/compat-http-diagnostics.mjs';

// Require an explicit target before constructing even the read-only client.
let base;
try { base = loopbackBase(process.env.COMPAT_BASE_URL); }
catch {
  console.error('COMPAT_BASE_URL must explicitly name a loopback HTTP origin (no credentials/path/query).');
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required. Run with --env-file=.env.local.');
  process.exit(1);
}
const sql = postgres(process.env.DATABASE_URL, {
  ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require',
  max: 1, prepare: false, connect_timeout: 10, idle_timeout: 1, onnotice: () => {},
  connection: { default_transaction_read_only: 'on' },
});

let stage = 'settings query';
try {
  const counts = await sql`
    with sources(source) as (
      values ('social_links.url'), ('analytics_scripts.script_id'), ('store_integrations.webhook_url')
    ), candidates as (
      select 'social_links.url'::text as source, url as candidate from public.social_links
      union all
      select 'analytics_scripts.script_id', script_id from public.analytics_scripts
      union all
      select 'store_integrations.webhook_url', webhook_url from public.store_integrations
    )
    select s.source, count(c.source)::int as rows_scanned,
      count(*) filter (where c.candidate ilike '%/api/admin%')::int as old_admin_references
    from sources s left join candidates c on c.source = s.source
    group by s.source order by s.source
  `;
  let references = 0;
  for (const row of counts) {
    references += row.old_admin_references;
    console.log(`${row.source}: ${row.rows_scanned} scanned, ${row.old_admin_references} old admin references`);
  }
  if (references) {
    console.error('STOP: classify the stored references privately before retiring APIs.');
    process.exitCode = 1;
    await sql.end({ timeout: 5 });
    process.exit(1);
  }

  // Only send IDs to the local app. Do not follow redirects or print their
  // locations: this checks DB-backed route resolution, not remote CDN bytes.
  stage = 'stored media inventory';
  const legacy = await sql`select id from media`;
  const shared = await sql`select id from store_media where deleted_at is null and storage_path is not null`;
  const checks = [
    ...legacy.map(row => `/api/admin/media/${encodeURIComponent(row.id)}`),
    ...shared.flatMap(row => [`/api/admin/media/${encodeURIComponent(row.id)}`, `/api/media/${encodeURIComponent(row.id)}`]),
  ];
  stage = 'local media HTTP check';
  const result = await checkMediaRoutes(base, checks);
  console.log(`Stored media route resolution: ${result.resolved}/${result.attempted} resolved (${legacy.length} legacy, ${shared.length} shared rows).`);
  console.log(`HTTP status failures (counts only): ${JSON.stringify(result.httpFailures)}`);
  console.log(`Transport failures (categories/counts only): ${JSON.stringify(result.transportFailures)}`);
  console.log(`Response-body cancellation failures: ${result.cancellationFailures}`);
  if (!checks.length) console.log('No stored media routes to check; HTTP acceptance remains unverified.');
  if (!result.ok || !checks.length) process.exitCode = 1;
} catch {
  console.error(`Compatibility gate failed at ${stage}; no stored values were logged.`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
