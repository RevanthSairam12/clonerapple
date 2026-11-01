import Link from 'next/link';
import { redirect } from 'next/navigation';

import { WebsiteThemeEditor } from '@/components/store-admin/website/WebsiteThemeEditor';
import { getStoreSession } from '@/lib/store-admin/auth';
import { getThemeSettings } from '@/lib/content';
import { THEME_FIELDS } from '@/lib/website/collections';
import { listThemeOverrides } from '@/lib/website/content-store';
import { canEditWebsite } from '@/lib/website/permissions';

export const dynamic = 'force-dynamic';

export default async function StoreAdminWebsiteThemePage() {
  const session = await getStoreSession();
  if (!session) redirect('/store-admin/login');

  const [values, overrides] = await Promise.all([getThemeSettings(), listThemeOverrides()]);

  return (
    <div>
      <Link className="sa-back" href="/store-admin/website">← Website</Link>
      {!overrides.ok ? (
        <p className="sa-warning">
          Saved theme values could not be read from the database, so the defaults are shown.
        </p>
      ) : null}
      <WebsiteThemeEditor
        fields={THEME_FIELDS}
        initial={values}
        overrides={overrides.ok ? overrides.data : []}
        canEdit={canEditWebsite(session.role) && overrides.ok}
      />
    </div>
  );
}
