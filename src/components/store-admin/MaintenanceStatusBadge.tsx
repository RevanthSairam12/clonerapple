import Link from 'next/link';

import type { MaintenanceStatus } from '@/lib/storefront/maintenance';

const TONE: Record<MaintenanceStatus, string> = {
  LIVE: 'sa-status sa-status-danger',
  SCHEDULED: 'sa-status sa-status-warn',
  OFF: 'sa-status sa-status-on',
};

const LABEL: Record<MaintenanceStatus, string> = {
  LIVE: 'Maintenance on',
  SCHEDULED: 'Scheduled',
  OFF: 'Live',
};

/**
 * The maintenance state, in the same status chip the rest of the panel uses.
 * Shown on the Overview and on Settings → Storefront; the toggle itself stays
 * owner-only on Settings → Business & maintenance.
 */
export function MaintenanceStatusBadge({
  status,
  preview = false,
}: {
  status: MaintenanceStatus;
  preview?: boolean;
}) {
  return (
    <span className="sa-inline-actions">
      <span className={TONE[status]} title="Decided by the toggle and the database clock">
        Storefront: {LABEL[status]}
      </span>
      {preview ? (
        <Link className="sa-link" href="/maintenance" target="_blank" rel="noreferrer">
          Preview maintenance page
        </Link>
      ) : null}
    </span>
  );
}
