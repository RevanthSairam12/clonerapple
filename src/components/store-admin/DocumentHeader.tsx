import type { StoreSettings } from '@/lib/store-admin/settings-rules';

export const DEFAULT_LEGAL_BUSINESS_NAME = 'RUPEEDO TECHNOLOGIES';
export const DEFAULT_UDYAM_MSME_NUMBER = 'UDYAM-AP-12-0109134';
export const DEFAULT_BUSINESS_ADDRESS =
  'SAI NIVAS, MOGALTUR, MASJID STREET, MOGALTHUR, AP, WESTGODAVARI, 534281';
export const DEFAULT_SUPPORT_PHONE = '+916304859367';
export const DEFAULT_SUPPORT_EMAIL = 'support@gadzio.co.in';

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
  const legalName = settings?.legal_name?.trim() || DEFAULT_LEGAL_BUSINESS_NAME;
  const address = settings?.address?.trim() || DEFAULT_BUSINESS_ADDRESS;
  const phone = settings?.phone?.trim() || DEFAULT_SUPPORT_PHONE;
  const email = settings?.email?.trim() || DEFAULT_SUPPORT_EMAIL;
  const udyamNumber = DEFAULT_UDYAM_MSME_NUMBER;

  if (customer) return (
    <header className="flex flex-col justify-between gap-5 border-b border-[#e5e5ea] pb-6 sm:flex-row">
      <div className="text-sm text-[#6e6e73]">
        <img
          src="/gadzio_logo.png"
          alt={tradeName}
          className="mb-2 h-10 w-auto object-contain"
        />
        <strong className="block text-base text-[#1d1d1f]">{tradeName}</strong>
        <p className="mt-0.5 text-xs font-semibold text-[#1d1d1f]">{legalName}</p>
        {address && <p className="mt-1 whitespace-pre-line">{address}</p>}
        {(phone || email) && <p className="mt-1">{[phone, email].filter(Boolean).join(' · ')}</p>}
        <p className="mt-1 text-xs font-medium text-[#1d1d1f]">MSME Udyam: {udyamNumber}</p>
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
        <img
          src="/gadzio_logo.png"
          alt={tradeName}
          className="mb-2 h-10 w-auto object-contain"
        />
        <span className="sa-doc-logo">
          <strong className="sa-doc-brand-name">{tradeName}</strong>
        </span>
        <span className="sa-doc-brand-meta"><strong>{legalName}</strong></span>
        {address ? <span className="sa-doc-brand-meta">{address}</span> : null}
        {phone || email ? (
          <span className="sa-doc-brand-meta">
            {phone ? `Phone: ${phone}` : ''}
            {phone && email ? ' · ' : ''}
            {email ? email : ''}
          </span>
        ) : null}
        <span className="sa-doc-brand-meta">MSME Udyam: {udyamNumber}</span>
      </div>

      <div className="sa-doc-heading">
        {badge ? <span className="sa-doc-badge">{badge}</span> : null}
        <h1 className="sa-doc-title">{title}</h1>
        {kicker ? <p className="sa-doc-kicker">{kicker}</p> : null}
      </div>
    </header>
  );
}
