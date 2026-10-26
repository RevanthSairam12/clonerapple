import type { StoreSettings } from '@/lib/store-admin/settings-rules';

interface Props {
  settings: StoreSettings | null;
  title: string;
  badge?: string;
  kicker?: string;
}

/** Brand block shared by the printable invoice and packing slip. */
export function DocumentHeader({ settings, title, badge, kicker }: Props) {
  const tradeName = settings?.trade_name?.trim() || 'Gadzio';
  const address = settings?.address?.trim() || '';
  const phone = settings?.phone?.trim() || '';
  const email = settings?.email?.trim() || '';

  return (
    <header className="sa-doc-top">
      <div className="sa-doc-brand">
        <span className="sa-doc-logo" aria-hidden="true">
          <span className="sa-logo-mark">{tradeName.slice(0, 1).toUpperCase()}</span>
          <strong className="sa-doc-brand-name">{tradeName}</strong>
        </span>
        {address ? <span className="sa-doc-brand-meta">{address}</span> : null}
        {phone || email ? (
          <span className="sa-doc-brand-meta">
            {phone ? `Phone: ${phone}` : ''}
            {phone && email ? ' · ' : ''}
            {email ? email : ''}
          </span>
        ) : null}
      </div>

      <div className="sa-doc-heading">
        {badge ? <span className="sa-doc-badge">{badge}</span> : null}
        <h1 className="sa-doc-title">{title}</h1>
        {kicker ? <p className="sa-doc-kicker">{kicker}</p> : null}
      </div>
    </header>
  );
}
