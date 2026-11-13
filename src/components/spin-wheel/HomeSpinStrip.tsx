import Link from 'next/link';

export interface HomeSpinBannerData {
  show: boolean;
  title: string;
  subtitle: string;
}

export function HomeSpinStrip({ banner }: { banner?: HomeSpinBannerData }) {
  if (!banner?.show) return null;

  return (
    <section
      aria-label="Spin and Win daily offer"
      style={{
        background: '#111111',
        color: '#ffffff',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <div
        style={{
          maxWidth: '1280px',
          margin: '0 auto',
          padding: '14px 20px',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
          <span
            style={{
              background: '#ffe100',
              color: '#111111',
              borderRadius: '9999px',
              padding: '4px 10px',
              fontSize: '11px',
              fontWeight: 800,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            Daily Spin
          </span>
          <strong style={{ fontSize: '15px', fontWeight: 700 }}>
            {banner.title || 'Spin and Win'}
          </strong>
          {banner.subtitle ? (
            <span style={{ fontSize: '13px', color: '#d1d5db' }}>{banner.subtitle}</span>
          ) : null}
        </div>
        <Link
          href="/spin-and-win"
          style={{
            background: '#ffe100',
            color: '#111111',
            borderRadius: '9999px',
            padding: '8px 18px',
            fontSize: '13px',
            fontWeight: 700,
            textDecoration: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          Spin and Win →
        </Link>
      </div>
    </section>
  );
}

