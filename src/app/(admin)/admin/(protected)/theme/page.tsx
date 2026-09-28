import { ThemeEditor } from '@/components/admin/ThemeEditor';
import { THEME_FIELDS } from '@/lib/admin/collections';
import { getThemeSettings } from '@/lib/content';

export const dynamic = 'force-dynamic';

export default async function AdminThemePage() {
  const values = await getThemeSettings();
  return (
    <div>
      <div className="admin-topbar">
        <div>
          <h1 className="admin-topbar-title">🎨 Theme &amp; Fonts</h1>
          <p className="admin-topbar-sub">Site-wide appearance</p>
        </div>
      </div>
      <div className="admin-content">
        <ThemeEditor fields={THEME_FIELDS} initial={values} />
      </div>
    </div>
  );
}
