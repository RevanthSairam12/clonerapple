import Link from 'next/link';
import { redirect } from 'next/navigation';

import { StaffManager } from '@/components/store-admin/StaffManager';
import { getStoreSession } from '@/lib/store-admin/auth';
import { listStaff } from '@/lib/store-admin/staff';
import { CAPABILITY_MATRIX, ROLE_SUMMARIES } from '@/lib/store-admin/staff-rules';

export const dynamic = 'force-dynamic';

export default async function StoreAdminStaffPage() {
  const session = await getStoreSession();
  if (!session) redirect('/store-admin/login');
  if (session.role === 'store_viewer') redirect('/store-admin/settings');

  const result = await listStaff();

  return (
    <div>
      <Link className="sa-back" href="/store-admin/settings">← Settings</Link>
      <h1 className="sa-page-title">Staff &amp; roles</h1>
      <p className="sa-page-sub">
        Store staff sign in through this panel only. Accounts are separate from the content
        panel&apos;s editors, and disabling one revokes every session immediately.
      </p>

      {result.ok ? (
        <StaffManager
          staff={result.data}
          canManage={session.role === 'store_owner'}
          currentAdminId={session.adminId}
        />
      ) : (
        <p className="sa-notice">
          Staff are not available. Apply migration 0029 and check the database connection.
        </p>
      )}

      <section className="sa-detail-section">
        <h2 className="sa-section-title">What each role can do</h2>
        <div className="sa-detail-grid">
          {(Object.keys(ROLE_SUMMARIES) as Array<keyof typeof ROLE_SUMMARIES>).map((role) => (
            <div className="sa-detail-card" key={role}>
              <h3 className="sa-card-title">{role.replace('store_', 'Store ')}</h3>
              <p className="sa-card-note">{ROLE_SUMMARIES[role]}</p>
            </div>
          ))}
        </div>

        <div className="sa-table-wrap">
          <table className="sa-table">
            <thead>
              <tr>
                <th>Area</th>
                <th>Capability</th>
                <th>Owner</th>
                <th>Admin</th>
                <th>Viewer</th>
              </tr>
            </thead>
            <tbody>
              {CAPABILITY_MATRIX.map((row) => (
                <tr key={row.capability}>
                  <td>{row.group}</td>
                  <td className="sa-mono">{row.capability}</td>
                  <td>{row.owner ? <span className="sa-yes">Yes</span> : <span className="sa-no">No</span>}</td>
                  <td>{row.admin ? <span className="sa-yes">Yes</span> : <span className="sa-no">No</span>}</td>
                  <td>{row.viewer ? <span className="sa-yes">Yes</span> : <span className="sa-no">No</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="sa-readonly-foot">
        Every change writes an audit row with the account, role and status — never the password.
      </p>
    </div>
  );
}
