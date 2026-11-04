import type { StoreSettings } from '@/lib/store-admin/settings-rules';

interface Props {
  settings: StoreSettings | null;
  title: string;
  badge?: string;
  kicker?: string;
  customer?: boolean;
}

/** Brand block shared by the printable invoice and packing slip. */
export function DocumentHeader({ settings, title, badge, kicker, customer = false }: Props) {
  const tradeName = settings?.trade_name?.trim() || 'Gadzio';
  const address = settings?.address?.trim() || '';
  const phone = settings?.phone?.trim() || '';
  const email = settings?.email?.trim() || '';

  if (customer) return (
    <header className="flex flex-col justify-between gap-5 border-b border-[#e5e5ea] pb-6 sm:flex-row">
      <div className="text-sm text-[#6e6e73]">
        <strong className="block text-base text-[#1d1d1f]">{tradeName}</strong>
        {address && <p className="mt-1 whitespace-pre-line">{address}</p>}
        {(phone || email) && <p className="mt-1">{[phone, email].filter(Boolean).join(' · ')}</p>}
      </div>
      <div className="sm:text-right">
        {badge && <p className="text-xs font-semibold uppercase tracking-wide text-[#6e6e73]">{badge}</p>}
        <h1 className="mt-1 text-3xl font-semibold">{title}</h1>
        {kicker && <p className="mt-2 text-sm text-[#6e6e73]">{kicker}</p>}
      </div>
    </header>
  );

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
