import path from 'node:path';
import { createJiti } from 'jiti';

// Invoke the actual payment read/mapping boundary with an injected SQL double.
// This proves dependency/money behavior, not PostgreSQL query correctness.
const jiti = createJiti(import.meta.url, { moduleCache: false, alias: { '@': path.resolve('src') },
  virtualModules: { '@/lib/platform/db': { getSql: () => { throw new Error('Unexpected application pool'); } } } });
export const { resolveCartItemsFromDbUsing } = await jiti.import(path.resolve('src/lib/payu/db-catalog.ts'));
export const { evaluateCoupon } = await jiti.import(path.resolve('src/lib/coupons/rules.ts'));
export const { quoteShipping } = await jiti.import(path.resolve('src/lib/checkout/shipping-rules.ts'));

export function paymentConnection({ expired = false, rows, failure } = {}) {
  const queries = [];
  const sql = async (strings) => {
    const query = strings.join('?'); queries.push(query);
    if (query.includes('from sale_settings')) return [{ enabled: true, starts_at: null, ends_at: new Date('2026-11-03T12:00:00Z'), db_now: new Date('2026-11-03T11:00:00Z') }];
    if (query.includes('clock_timestamp()')) return [{ db_now: new Date(expired ? '2026-11-03T12:00:00Z' : '2026-11-03T11:59:00Z') }];
    if (query.includes('from products p')) { if (failure) throw failure; return rows ?? [
      { id: 'case', name: 'Case', inventory_mode: 'variant', price_paise: 10000, sale_price_paise: 8000, variant_id: 'inherited', variant_sku: 'BASE', option_price_paise: null, option_sale_price_paise: null, track_inventory: true },
      { id: 'case', name: 'Case', inventory_mode: 'variant', price_paise: 10000, sale_price_paise: 8000, variant_id: 'override', variant_sku: 'PRO', option_price_paise: 15000, option_sale_price_paise: 12000, track_inventory: true },
    ]; }
    throw new Error('Unexpected SQL boundary');
  };
  return { sql, queries };
}
