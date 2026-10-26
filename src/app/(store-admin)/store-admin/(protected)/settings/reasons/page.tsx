import { CancellationReasonForm } from '@/components/store-admin/CancellationReasonForm';
import { SettingList } from '@/components/store-admin/SettingList';
import { SettingsNav } from '@/components/store-admin/SettingsNav';
import { getStoreSession } from '@/lib/store-admin/auth';
import { listCancellationReasons } from '@/lib/store-admin/returns';
import { LIST_KINDS, listSettingRows } from '@/lib/store-admin/setting-lists';

export const dynamic = 'force-dynamic';

export default async function StoreAdminReasonsPage() {
  const session = await getStoreSession();
  const [cancellation, refunds, returns] = await Promise.all([
    listCancellationReasons(),
    listSettingRows('refund-reasons'),
    listSettingRows('return-reasons'),
  ]);
  const canEdit = session?.role === 'store_admin' || session?.role === 'store_owner';
  const refundKind = LIST_KINDS['refund-reasons'];
  const returnKind = LIST_KINDS['return-reasons'];

  return (
    <div>
      <h1 className="sa-page-title">Reasons</h1>
      <p className="sa-page-sub">
        The pick-lists staff use when cancelling an order, recording a refund or accepting a return.
        Reports group by these labels, so keep them broad.
      </p>

      <SettingsNav active="/store-admin/settings/reasons" />

      <section className="sa-detail-card">
        <div className="sa-detail-head">
          <h2>Cancellation reasons</h2>
        </div>
        {cancellation.ok ? (
          <CancellationReasonForm reasons={cancellation.reasons} canEdit={canEdit} />
        ) : (
          <p className="sa-notice">
            Reasons are not available. Apply migration 0023 and check the database connection.
          </p>
        )}
      </section>

      {refunds.ok ? (
        <SettingList
          listKey={refundKind.key}
          label={refundKind.label}
          fields={refundKind.fields}
          rows={refunds.data}
          canEdit={canEdit}
        />
      ) : (
        <p className="sa-notice">Refund reasons could not be read. Apply migration 0032.</p>
      )}

      {returns.ok ? (
        <SettingList
          listKey={returnKind.key}
          label={returnKind.label}
          fields={returnKind.fields}
          rows={returns.data}
          canEdit={canEdit}
        />
      ) : (
        <p className="sa-notice">Return reasons could not be read. Apply migration 0032.</p>
      )}

      <p className="sa-readonly-foot">
        Reasons are hidden, never deleted, so past orders, refunds and returns keep their label.
      </p>
    </div>
  );
}
