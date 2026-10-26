import { getSql } from '@/lib/admin/db';
import { getStoreSettings } from '@/lib/store-admin/settings';
import { DEFAULT_SETTINGS, type StoreSettings } from '@/lib/store-admin/settings-rules';

import { type ShippingMethodLike, type ShippingPolicy } from './shipping-rules';

/**
 * Server-side readers for the settings checkout depends on.
 *
 * Checkout fails closed: once a database is configured, a failed settings or
 * shipping-methods read returns `unavailable` and the initiate route refuses
 * the payment instead of inventing a rate. A local build with no
 * DATABASE_URL keeps running on the coded defaults.
 */

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Checkout settings must be read on the server only.');
}

export type CheckoutSettingsLoad =
  | { ok: true; settings: StoreSettings }
  | { ok: false; reason: 'unavailable' };

export async function readCheckoutSettings(): Promise<CheckoutSettingsLoad> {
  try {
    const result = await getStoreSettings();
    if (result.ok) return result;
  } catch {
    // Fall through to the unavailable branch.
  }
  if (!getSql()) return { ok: true, settings: { ...DEFAULT_SETTINGS } };
  return { ok: false, reason: 'unavailable' };
}

export type ShippingPolicyLoad =
  | { ok: true; policy: ShippingPolicy }
  | { ok: false; reason: 'unavailable' };

/** Whole rupees from a settings field, converted to integer paise. */
export function rupeesToPaise(value: unknown): number {
  const parsed = Number(String(value ?? '').trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.trunc(parsed * 100);
}

interface ShippingMethodRow {
  id: string;
  name: string;
  rate_paise: string | number;
  free_over_paise: string | number;
  is_active: boolean;
  sort_order: string | number;
}

function mapMethod(row: ShippingMethodRow): ShippingMethodLike {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    ratePaise: Number(row.rate_paise) || 0,
    freeOverPaise: Number(row.free_over_paise) || 0,
    isActive: Boolean(row.is_active),
    sortOrder: Number(row.sort_order) || 0,
  };
}

async function policyForSettings(settings: StoreSettings): Promise<ShippingPolicyLoad> {
  const enabled = settings.shipping_enabled === 'on';
  const freeShippingOverPaise = rupeesToPaise(settings.free_shipping_over);

  const sql = getSql();
  if (!sql) return { ok: true, policy: { enabled, freeShippingOverPaise, methods: [] } };

  try {
    const rows = (await sql`
      select id, name, rate_paise, free_over_paise, is_active, sort_order
      from shipping_methods
      order by sort_order asc, name asc, id asc
    `) as ShippingMethodRow[];
    return {
      ok: true,
      policy: { enabled, freeShippingOverPaise, methods: rows.map(mapMethod) },
    };
  } catch {
    console.warn('[checkout/settings] could not read shipping methods');
    return { ok: false, reason: 'unavailable' };
  }
}

/**
 * Active and inactive methods plus the two order settings that decide the
 * charge. The table is empty by default, which means no charge — exactly the
 * behaviour checkout had before shipping was wired.
 */
export async function readShippingPolicy(): Promise<ShippingPolicyLoad> {
  const settingsResult = await readCheckoutSettings();
  if (!settingsResult.ok) return settingsResult;
  return await policyForSettings(settingsResult.settings);
}

export type CheckoutConfiguration =
  | { ok: true; settings: StoreSettings; policy: ShippingPolicy }
  | { ok: false; reason: 'unavailable' };

/** One settings read for callers that need both the values and the policy. */
export async function readCheckoutConfiguration(): Promise<CheckoutConfiguration> {
  const settingsResult = await readCheckoutSettings();
  if (!settingsResult.ok) return settingsResult;
  const policyResult = await policyForSettings(settingsResult.settings);
  if (!policyResult.ok) return policyResult;
  return {
    ok: true,
    settings: settingsResult.settings,
    policy: policyResult.policy,
  };
}
