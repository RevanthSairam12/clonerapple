import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getUserSession } from '@/lib/user-auth';
import { AuthForm } from '@/components/auth/AuthForm';

import './auth.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Sign In - Gadzio',
  description:
    'Sign in with your account or create a new one to access all Gadzio services.',
};

interface AuthPageProps {
  searchParams: Promise<{ redirect?: string; mode?: string }>;
}

export default async function AuthPage({ searchParams }: AuthPageProps) {
  const session = await getUserSession();
  const { redirect: redirectUrl, mode } = (await searchParams) || {};
  const destination =
    redirectUrl && redirectUrl.startsWith('/') && !redirectUrl.startsWith('//')
      ? redirectUrl
      : '/';

  if (session) redirect(destination);

  return (
    <div className="auth-page">
      <div className="auth-wrapper">
        <div className="auth-container">
          {/* Left — form */}
          <div className="auth-panel-left">
            <AuthForm
              initialMode={mode === 'signup' ? 'signup' : 'signin'}
              redirectTo={destination}
            />
          </div>

          {/* Right — QR download */}
          <div className="auth-panel-right">
            <div className="auth-qr-box">
              {/* QR code SVG (static decorative pattern) */}
              <svg viewBox="0 0 130 130" xmlns="http://www.w3.org/2000/svg">
                {/* Top-left finder */}
                <rect x="4" y="4" width="36" height="36" rx="4" fill="none" stroke="#1d1d1f" strokeWidth="4"/>
                <rect x="12" y="12" width="20" height="20" rx="2" fill="#1d1d1f"/>
                {/* Top-right finder */}
                <rect x="90" y="4" width="36" height="36" rx="4" fill="none" stroke="#1d1d1f" strokeWidth="4"/>
                <rect x="98" y="12" width="20" height="20" rx="2" fill="#1d1d1f"/>
                {/* Bottom-left finder */}
                <rect x="4" y="90" width="36" height="36" rx="4" fill="none" stroke="#1d1d1f" strokeWidth="4"/>
                <rect x="12" y="98" width="20" height="20" rx="2" fill="#1d1d1f"/>
                {/* Data modules — decorative pattern */}
                <rect x="48" y="8" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="58" y="8" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="68" y="8" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="78" y="8" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="48" y="18" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="68" y="18" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="48" y="28" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="58" y="28" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="78" y="28" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="48" y="38" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="58" y="38" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="68" y="38" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="78" y="38" width="6" height="6" rx="1" fill="#1d1d1f"/>
                {/* Middle row */}
                <rect x="8" y="48" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="18" y="48" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="38" y="48" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="48" y="48" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="68" y="48" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="88" y="48" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="98" y="48" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="118" y="48" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="8" y="58" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="28" y="58" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="48" y="58" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="58" y="58" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="78" y="58" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="98" y="58" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="108" y="58" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="8" y="68" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="18" y="68" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="28" y="68" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="48" y="68" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="68" y="68" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="78" y="68" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="88" y="68" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="108" y="68" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="118" y="68" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="8" y="78" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="28" y="78" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="38" y="78" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="58" y="78" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="68" y="78" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="98" y="78" width="6" height="6" rx="1" fill="#1d1d1f"/>
                {/* Bottom-right area */}
                <rect x="48" y="88" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="58" y="88" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="78" y="88" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="88" y="88" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="108" y="88" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="48" y="98" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="68" y="98" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="88" y="98" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="98" y="98" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="118" y="98" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="48" y="108" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="58" y="108" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="78" y="108" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="98" y="108" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="108" y="108" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="48" y="118" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="68" y="118" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="78" y="118" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="88" y="118" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="108" y="118" width="6" height="6" rx="1" fill="#1d1d1f"/>
                <rect x="118" y="118" width="6" height="6" rx="1" fill="#1d1d1f"/>
              </svg>
            </div>
            <p className="auth-qr-label">Scan to QR</p>
            <p className="auth-qr-title">Download the<br />Business app</p>
          </div>
        </div>

        {/* Footer */}
        <footer className="auth-footer">
          <a href="/privacy" className="auth-footer-link">Privacy Policy</a>
          <span className="auth-footer-dot" aria-hidden="true" />
          <a href="/terms" className="auth-footer-link">Terms &amp; Conditions</a>
        </footer>
      </div>
    </div>
  );
}
