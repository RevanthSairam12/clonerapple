import type { SaleStatus } from '@/lib/storefront/sale';
import { saleStatusLabel } from '@/lib/store-admin/sale-admin-rules';

/**
 * The one sale badge, rendered from the database-clock status. Server-safe:
 * the status is decided before it reaches this component.
 */
export function SaleStatusBadge({ status }: { status: SaleStatus }) {
  const tone = status === 'live' ? 'is-live' : status === 'scheduled' ? 'is-scheduled' : 'is-off';
  return (
    <span className={`sa-sale-badge ${tone}`} data-status={status}>
      {saleStatusLabel(status)}
    </span>
  );
}
