import { SettingList } from '@/components/store-admin/SettingList';
import { SettingsNav } from '@/components/store-admin/SettingsNav';
import { getStoreSession } from '@/lib/store-admin/auth';
import { LIST_KINDS, listSettingRows } from '@/lib/store-admin/setting-lists';

export const dynamic = 'force-dynamic';

export default async function StoreAdminContentSettingsPage() {
  const session = await getStoreSession();
  const [pages, seo] = await Promise.all([
    listSettingRows('pages'),
    listSettingRows('seo'),
  ]);
  const canEdit = session?.role === 'store_admin' || session?.role === 'store_owner';
  const pageKind = LIST_KINDS.pages;
  const seoKind = LIST_KINDS.seo;

  return (
    <div>
      <h1 className="sa-page-title">Pages and SEO</h1>
      <p className="sa-page-sub">
        Policy pages shown in the storefront footer, and the meta defaults for each storefront page.
      </p>

      <SettingsNav active="/store-admin/settings/content" />

      {pages.ok ? (
        <SettingList
          listKey={pageKind.key}
          label={pageKind.label}
          fields={pageKind.fields}
          rows={pages.data}
          canEdit={canEdit}
        />
      ) : (
        <p className="sa-notice">Store pages could not be read. Apply migration 0032.</p>
      )}

      {seo.ok ? (
        <SettingList
          listKey={seoKind.key}
          label={seoKind.label}
          fields={seoKind.fields}
          rows={seo.data}
          canEdit={canEdit}
          fixedRows
        />
      ) : (
        <p className="sa-notice">SEO defaults could not be read. Apply migration 0032.</p>
      )}

      <p className="sa-readonly-foot">
        A page is only reachable from the storefront when its status is Published. SEO rows already
        exist for every storefront route and cannot be added here.
      </p>
    </div>
  );
}
