import type postgres from 'postgres';
import type { TransactionSql } from 'postgres';

import { getSql } from '@/lib/platform/db';
import { DEFAULT_SETTINGS, isStoreSettingKey, validateSettingValue, type StoreSettings } from '@/lib/store-admin/settings-rules';
import { EMPTY_SHIPPING_POLICY, type ShippingPolicy } from './shipping-rules';

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Checkout settings must be read on the server only.');
}

type Unavailable = { ok: false; reason: 'unavailable'; error?: string };
export type CheckoutSettingsLoad = { ok: true; settings: StoreSettings } | Unavailable;
export type ShippingPolicyLoad = { ok: true; policy: ShippingPolicy } | Unavailable;
export type CheckoutConfiguration = { ok: true; settings: StoreSettings; policy: ShippingPolicy } | Unavailable;

/** No cache: caller transactions read the authoritative settings, not process state. */
export async function readCheckoutConfigurationUsing(
  sql: postgres.Sql | TransactionSql,
): Promise<CheckoutConfiguration> {
  try {
    const rows = await sql`select key, value from store_settings`;
    // Check actual rows BEFORE applying defaults: blank threshold is a valid row.
    const raw = new Map<string, unknown>(rows.map((row) => [String(row.key), row.value]));
    if (!raw.has('shipping_charge_paise') || !raw.has('free_shipping_threshold_paise')) {
      return { ok: false, reason: 'unavailable', error: 'Shipping settings require initialization. Run the shipping-policy bootstrap before accepting checkout.' };
    }
    for (const key of ['shipping_charge_paise', 'free_shipping_threshold_paise'] as const) {
      if (!validateSettingValue(key, raw.get(key)).ok) {
        return { ok: false, reason: 'unavailable', error: 'Shipping settings are invalid. Contact the store administrator.' };
      }
    }
    if (raw.has('shipping_enabled') && raw.get('shipping_enabled') !== 'on' && raw.get('shipping_enabled') !== 'off') {
      return { ok: false, reason: 'unavailable', error: 'Shipping settings are invalid. Contact the store administrator.' };
    }
    const settings: StoreSettings = { ...DEFAULT_SETTINGS };
    for (const [key, value] of raw) {
      if (isStoreSettingKey(key)) settings[key] = value == null ? '' : String(value);
    }
    return {
      ok: true,
      settings,
      policy: {
        enabled: settings.shipping_enabled === 'on',
        chargePaise: Number(settings.shipping_charge_paise),
        freeShippingThresholdPaise: settings.free_shipping_threshold_paise.trim() === ''
          ? null : Number(settings.free_shipping_threshold_paise),
      },
    };
  } catch {
    console.warn('[checkout/settings] could not read checkout configuration');
    return { ok: false, reason: 'unavailable' };
  }
}

export async function readCheckoutConfiguration(): Promise<CheckoutConfiguration> {
  const sql = getSql();
  // Database-free local builds may render, but configured stores never invent rates.
  if (!sql) return { ok: true, settings: { ...DEFAULT_SETTINGS }, policy: { ...EMPTY_SHIPPING_POLICY } };
  return readCheckoutConfigurationUsing(sql);
}

export async function readCheckoutSettings(): Promise<CheckoutSettingsLoad> {
  const result = await readCheckoutConfiguration();
  return result.ok ? { ok: true, settings: result.settings } : result;
}

export async function readShippingPolicy(): Promise<ShippingPolicyLoad> {
  const result = await readCheckoutConfiguration();
  return result.ok ? { ok: true, policy: result.policy } : result;
}
