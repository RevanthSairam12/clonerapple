/**
 * Read-only smoke for the Phase 9 settings tables.
 *
 * Selects the exact columns the settings screens select, so a missing column,
 * a wrong name or an unapplied migration shows up before a page does. Only
 * table names and row counts are printed — never a connection string.
 *
 * Usage: node scripts/check-setting-lists.mjs
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import postgres from 'postgres';

const envPath = path.resolve(process.cwd(), '.env.local');
try {
  const env = await readFile(envPath, 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {
  // DATABASE_URL must come from the real environment then.
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const url = new URL(process.env.DATABASE_URL);
const isPooler = url.hostname.includes('pooler') && url.port === '6543';
const sql = postgres(process.env.DATABASE_URL, {
  max: 1,
  ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require',
  prepare: !isPooler,
  onnotice: () => {},
});

const TABLES = [
  ['fulfilment_providers', 'id, name, tracking_template, is_active, sort_order, updated_at'],
  ['shipping_methods', 'id, name, rate_paise, free_over_paise, eta_min_days, eta_max_days, is_active, sort_order, updated_at'],
  ['payment_methods', 'id, code, label, kind, instructions, is_active, sort_order, updated_at'],
  ['store_pages', 'id, slug, title, body, seo_title, seo_description, status, updated_at'],
  ['seo_pages', 'page_key, meta_title, meta_description, meta_image_media_id, robots_index, robots_follow, updated_at'],
  ['social_links', 'id, network, url, is_active, sort_order, updated_at'],
  ['analytics_scripts', 'id, provider, script_id, is_active, updated_at'],
  ['store_integrations', 'id, provider, region, bucket, sender_identity, webhook_url, is_active, updated_at'],
  ['email_templates', 'id, template_key, name, subject, heading, body, button_label, button_url, footer_text, is_active, updated_at'],
  ['automated_messages', 'id, message_key, label, channel, subject, body, delay_minutes, is_active, updated_at'],
  ['refund_reasons', 'id, label, is_active, sort_order, updated_at'],
  ['return_reasons', 'id, label, is_active, sort_order, updated_at'],
];

let failed = false;

try {
  for (const [table, columns] of TABLES) {
    try {
      const rows = await sql.unsafe(`select ${columns} from ${table}`);
      console.log(`${table}: OK (${rows.length} row(s))`);
    } catch (error) {
      failed = true;
      console.error(`${table}: FAIL (${error instanceof Error ? error.message : 'read failed'})`);
    }
  }

  const [matrix] = await sql.unsafe(
    'select count(*)::int as count from notification_channel_settings',
  );
  console.log(`notification_channel_settings: OK (${matrix.count} row(s))`);
  if (matrix.count !== 72) {
    console.error('notification_channel_settings: expected 72 cells (3 channels × 2 audiences × 12 topics)');
    failed = true;
  }

  const [settings] = await sql.unsafe('select count(*)::int as count from store_settings');
  console.log(`store_settings: OK (${settings.count} row(s))`);

  const staff = await sql.unsafe(
    'select phone, must_change_password from store_admins limit 1',
  );
  console.log(`store_admins: OK (${staff.length === 0 ? '0 rows' : 'columns present'})`);
} finally {
  await sql.end({ timeout: 5 });
}

if (failed) process.exit(1);
console.log('\nAll settings tables are readable.');
