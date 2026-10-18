import { getStoreSession } from '@/lib/store-admin/auth';

export const dynamic = 'force-dynamic';

const AREAS = [
  {
    title: 'Catalogue',
    note: 'Products, categories, facets and stock levels will live here.',
    tag: 'Next step',
  },
  {
    title: 'Orders',
    note: 'Read-only order lookup and fulfilment status will live here.',
    tag: 'Next step',
  },
  {
    title: 'Audit log',
    note: 'Login, role and data changes recorded in store_admin_audit.',
    tag: 'Next step',
  },
];

export default async function StoreAdminDashboard() {
  const session = await getStoreSession();

  return (
    <div>
      <h1 className="sa-page-title">Store overview</h1>
      <p className="sa-page-sub">
        Signed in as {session?.name || 'store staff'} with the{' '}
        {session?.role.replace('_', ' ')} role.
      </p>

      <p className="sa-notice">
        Foundation release: authentication, roles and the audit pipeline are live.
        Catalogue editing is not enabled yet, and price editing stays disabled until
        payments read prices from the database.
      </p>

      <div className="sa-grid">
        {AREAS.map((area) => (
          <section key={area.title} className="sa-card">
            <h2 className="sa-card-title">{area.title}</h2>
            <p className="sa-card-note">{area.note}</p>
            <span className="sa-tag">{area.tag}</span>
          </section>
        ))}
      </div>

      <h2 className="sa-section-title">Role capabilities</h2>
      <ul className="sa-capability">
        <li>
          <span>Read catalogue and order data</span>
          <span className="sa-yes">All roles</span>
        </li>
        <li>
          <span>Edit catalogue and stock</span>
          <span className={session?.role === 'store_viewer' ? 'sa-no' : 'sa-yes'}>
            {session?.role === 'store_viewer' ? 'Not for viewers' : 'Admin and owner'}
          </span>
        </li>
        <li>
          <span>Manage store admins</span>
          <span className={session?.role === 'store_owner' ? 'sa-yes' : 'sa-no'}>
            Owner only
          </span>
        </li>
        <li>
          <span>Edit prices</span>
          <span className="sa-no">Disabled until payments read the database</span>
        </li>
      </ul>
    </div>
  );
}
