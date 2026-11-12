import type { Metadata } from 'next';

import { ResetPasswordForm } from '@/components/auth/ResetPasswordForm';
import { GadzioHeader } from '@/components/header/GadzioHeader';
import { GlobalFooter } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/GlobalFooter';

import '../auth/auth.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Reset Password - Gadzio',
  description: 'Set a new password for your Gadzio account.',
};

export default function ResetPasswordPage() {
  return (
    <div
      className="gz-storefront-page min-h-screen bg-[#f5f5f7] text-[#1d1d1f] selection:bg-[#ffe100] selection:text-black"
      style={{ fontFamily: 'transducer, sans-serif' }}
    >
      <GadzioHeader accountHref="/auth" bannerVisible={false} />
      <div className="auth-page">
        <div className="auth-wrapper">
          <div className="auth-container">
            <div className="auth-panel-left">
              <ResetPasswordForm />
            </div>
            <div className="auth-panel-right">
              <div className="auth-quote-badge" aria-hidden="true">
                <span>“</span>
              </div>
              <blockquote className="auth-quote-text">
                Everyday essentials, engineered to protect what matters most — with precision fit and zero compromise.
              </blockquote>
              <div className="auth-quote-divider" aria-hidden="true" />
              <p className="auth-quote-sub">
                Updating your password signs out all existing sessions so only you have access.
              </p>
              <span className="auth-quote-signature">GADZIO SECURITY</span>
            </div>
          </div>
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

