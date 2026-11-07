/**
 * Preserve effective legacy shipping configuration without changing legacy/order rows.
 *   node scripts/bootstrap-shipping-policy.mjs              # read-only dry run
 *   node scripts/bootstrap-shipping-policy.mjs --apply      # explicit atomic cutover
 * Run dry-run and verify parity BEFORE deploying the canonical checkout reader.
 * No canonical value is overwritten; a partial pair requires operator repair.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createJiti } from 'jiti';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jiti = createJiti(import.meta.url, { moduleCache: false, alias: { '@': path.join(root, 'src') } });
const { shippingPolicyFromLegacy } = await jiti.import(path.join(root, 'src/lib/checkout/shipping-rules.ts'));
const { validateSettingValue } = await jiti.import(path.join(root, 'src/lib/store-admin/settings-rules.ts'));

const KEYS = ['shipping_charge_paise', 'free_shipping_threshold_paise'];

/** Pure planning entry point, also used by focused tests. Input order is significant. */
export function planShippingBootstrap(settingsRows, methodRows) {
  const settings = new Map(settingsRows.map((row) => [row.key, row.value]));
  const present = KEYS.filter((key) => settings.has(key));
  if (present.length === 1) throw new Error('Partial canonical shipping pair: repair explicitly; no values were guessed.');
  if (present.length === 2) {
    if (KEYS.some((key) => !validateSettingValue(key, settings.get(key)).ok)) {
      throw new Error('Canonical shipping values are invalid; no values were overwritten.');
    }
    return { status: 'already-initialized', values: Object.fromEntries(KEYS.map((key) => [key, settings.get(key)])) };
  }
  const policy = shippingPolicyFromLegacy(
    (settings.get('shipping_enabled') ?? 'on') === 'on',
    settings.get('free_shipping_over') ?? '0',
    methodRows.map((row) => ({
      id: String(row.id), name: String(row.name ?? ''),
      ratePaise: Number(row.rate_paise) || 0,
      freeOverPaise: Number(row.free_over_paise) || 0,
      isActive: Boolean(row.is_active), sortOrder: Number(row.sort_order) || 0,
    })),
  );
  const values = {
    shipping_charge_paise: String(policy.chargePaise),
    free_shipping_threshold_paise: policy.freeShippingThresholdPaise === null ? '' : String(policy.freeShippingThresholdPaise),
  };
  if (KEYS.some((key) => !validateSettingValue(key, values[key]).ok)) {
    throw new Error('Legacy shipping exceeds supported bounds; explicit operator review is required.');
  }
  return { status: 'ready', enabled: policy.enabled, values };
}

/** Injected connection and audit writer make transaction/rollback behavior testable. */
export async function bootstrapShippingPolicyUsing(sql, writeAudit, apply = false) {
  return sql.begin(async (tx) => {
    if (apply) {
      // Blocks INSERT/UPDATE/DELETE from every legacy writer, including writers
      // that do not participate in advisory locks. Always lock settings first.
      await tx`lock table store_settings, shipping_methods in share row exclusive mode`;
    } else {
      await tx`set transaction isolation level repeatable read, read only`;
    }
    const settings = await tx`select key, value from store_settings`;
    // Match the old reader's DB ordering BEFORE the stable JavaScript selector.
    const methods = await tx`
      select id, name, rate_paise, free_over_paise, is_active, sort_order
      from shipping_methods order by sort_order asc, name asc, id asc
    `;
    const plan = planShippingBootstrap(settings, methods);
    if (!apply || plan.status === 'already-initialized') return plan;
    // Values were freshly derived under the locks, never taken from a dry-run file.
    for (const key of KEYS) {
      await tx`
        insert into store_settings (key, value, updated_by, updated_at)
        values (${key}, ${plan.values[key]}, null, now())
      `;
    }
    const audited = await writeAudit({
      actorId: null,
      action: 'settings.shipping.bootstrap',
      entity: 'store_settings',
      entityId: KEYS.join(','),
      before: { canonicalPolicyPresent: false },
      after: plan.values,
      reason: 'preserve_legacy_shipping_policy',
      route: 'scripts/bootstrap-shipping-policy',
    }, tx);
    if (!audited) throw new Error('Shipping bootstrap audit failed; transaction rolled back.');
    return { ...plan, status: 'applied' };
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--apply' && arg !== '--dry-run') || (args.includes('--apply') && args.includes('--dry-run'))) {
    console.error('Usage: node scripts/bootstrap-shipping-policy.mjs [--dry-run | --apply]');
    process.exitCode = 1;
    return;
  }
  // Native env loading respects existing process variables and never prints values.
  try { process.loadEnvFile(path.join(root, '.env.local')); } catch { /* external env is supported */ }
  const connectionUrl = (process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL || '').trim();
  if (!connectionUrl) {
    console.error('DATABASE_MIGRATION_URL or DATABASE_URL is required. No changes made.');
    process.exitCode = 1;
    return;
  }
  if (new URL(connectionUrl).port === '6543') {
    console.error('Refusing port 6543 (transaction pooler): use a session connection on port 5432.');
    process.exitCode = 1;
    return;
  }
  const { default: postgres } = await import('postgres');
  const sql = postgres(connectionUrl, {
    max: 1, prepare: false,
    ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require',
    onnotice: () => {},
  });
  try {
    const { writeAudit } = await jiti.import(path.join(root, 'src/lib/store-admin/audit.ts'));
    const apply = args.includes('--apply');
    const result = await bootstrapShippingPolicyUsing(sql, writeAudit, apply);
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...result }));
    if (!apply) console.log('Read-only dry run. Verify the legacy-policy parity before explicitly applying with --apply.');
  } catch {
    // Driver errors may contain connection information: never print raw errors.
    console.error('Shipping bootstrap refused or failed. Check for a partial/invalid canonical pair, unsupported legacy amounts, or database/audit availability. No changes committed.');
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();
