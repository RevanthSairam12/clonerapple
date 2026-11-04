'use client';

import type { StorefrontPurchasableVariant } from '@/lib/catalog/storefront';
import { STOCK_NOT_AVAILABLE, stockBlocked } from '@/lib/storefront/availability-rules';

/** One configured sellable combination per option; never creates a model × finish Cartesian product. */
export function CommerceVariantSelector({ variants, value, onChange, saleLive, liveStock }: {
  variants: StorefrontPurchasableVariant[];
  value: string;
  onChange: (id: string) => void;
  saleLive: boolean;
  liveStock: Record<string, boolean>;
}) {
  return (
    <div className="mb-6">
      <label htmlFor="commerce-variant" className="block text-xs font-semibold mb-2">Model / specification</label>
      <select id="commerce-variant" value={value} onChange={(event) => onChange(event.target.value)}
        className="w-full border border-[#d2d2d7] rounded-xl px-3 py-3 bg-white text-sm">
        <option value="">Choose your model / specification</option>
        {variants.map((variant) => {
          const blocked = stockBlocked(liveStock[variant.id] ?? variant.inStock, saleLive);
          return <option key={variant.id} value={variant.id} disabled={blocked}>
            {variant.label}{blocked ? ` — ${STOCK_NOT_AVAILABLE}` : ''}
          </option>;
        })}
      </select>
      {!variants.length ? <p className="text-sm mt-2">No purchasable combinations are configured.</p> : null}
    </div>
  );
}
