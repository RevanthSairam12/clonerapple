import { SettingList } from '@/components/store-admin/SettingList';
import { SettingsNav } from '@/components/store-admin/SettingsNav';
import { TrackingTemplateTester } from '@/components/store-admin/TrackingTemplateTester';
import { getStoreSession } from '@/lib/store-admin/auth';
import { LIST_KINDS, listSettingRows } from '@/lib/store-admin/setting-lists';

export const dynamic = 'force-dynamic';

export default async function StoreAdminShippingSettingsPage() {
  const session = await getStoreSession();
  const [providers, methods] = await Promise.all([
    listSettingRows('fulfilment-providers'),
    listSettingRows('shipping-methods'),
  ]);
  const canEdit = session?.role === 'store_admin' || session?.role === 'store_owner';
  const providerKind = LIST_KINDS['fulfilment-providers'];
  const methodKind = LIST_KINDS['shipping-methods'];

  const providerOptions =
    providers.ok
      ? providers.data.map((row) => ({
          name: row.values.name ?? '',
          template: row.values.tracking_template ?? '',
        }))
      : [];

  return (
    <div>
      <h1 className="sa-page-title">Shipping and fulfilment</h1>
      <p className="sa-page-sub">
        Couriers and their tracking URL templates, plus the delivery rates the storefront offers.
      </p>

      <SettingsNav active="/store-admin/settings/shipping" />

      <p className="sa-notice">
        There is no courier API. When staff save a courier delivery, the tracking link is built from
        the template whose courier name matches — a link typed by hand always wins.
      </p>

      {providers.ok ? (
        <SettingList
          listKey={providerKind.key}
          label={providerKind.label}
          fields={providerKind.fields}
          rows={providers.data}
          canEdit={canEdit}
        />
      ) : (
        <p className="sa-notice">Couriers could not be read. Apply migration 0032.</p>
      )}

      <section className="sa-detail-card">
        <div className="sa-detail-head">
          <h2>Tracking link preview</h2>
        </div>
        <TrackingTemplateTester providers={providerOptions} />
      </section>

      {methods.ok ? (
        <SettingList
          listKey={methodKind.key}
          label={methodKind.label}
          fields={methodKind.fields}
          rows={methods.data}
          canEdit={canEdit}
        />
      ) : (
        <p className="sa-notice">Shipping methods could not be read. Apply migration 0032.</p>
      )}
    </div>
  );
}
