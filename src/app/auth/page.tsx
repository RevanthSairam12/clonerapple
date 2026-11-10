import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getUserSession } from '@/lib/user-auth';
import { safeRedirectPath } from '@/lib/auth/redirect';
import { AuthForm } from '@/components/auth/AuthForm';
import { GadzioHeader } from '@/components/header/GadzioHeader';
import { GlobalFooter } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/GlobalFooter';

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
  // Same-origin relative paths only; anything else falls back to the home page.
  const destination = safeRedirectPath(redirectUrl, '/');

  if (session) redirect(destination);

  return (
    <div
      className="gz-storefront-page min-h-screen bg-[#f5f5f7] text-[#1d1d1f] selection:bg-[#ffe100] selection:text-black"
      style={{ fontFamily: 'transducer, sans-serif' }}
    >
      <GadzioHeader accountHref="/auth" bannerVisible={false} />
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

            {/* Right — Brand quote & member perks */}
            <div className="auth-panel-right">
              <div className="auth-quote-badge" aria-hidden="true">
                <span>“</span>
              </div>
              <blockquote className="auth-quote-text">
                Everyday essentials, engineered to protect what matters most — with precision fit and zero compromise.
              </blockquote>
              <div className="auth-quote-divider" aria-hidden="true" />
              <p className="auth-quote-sub">
                Track orders live, manage saved delivery addresses, and access instant digital receipts in one place.
              </p>
              <span className="auth-quote-signature">GADZIO SIGNATURE</span>
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
      <GlobalFooter />
    </div>
  );
}
