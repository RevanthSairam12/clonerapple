import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terms of Use - Gadzio',
  description: 'Review Gadzio terms and conditions of use.',
};

export default function TermsPage() {
  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#f5f5f7',
      color: '#1d1d1f',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      padding: '48px 24px',
    }}>
      <div style={{
        maxWidth: 760,
        margin: '0 auto',
        backgroundColor: '#fff',
        borderRadius: 18,
        padding: '48px 40px',
        boxShadow: '0 2px 12px rgba(0, 0, 0, 0.04)',
      }}>
        <div style={{ marginBottom: 32 }}>
          <Link
            href="/auth"
            style={{
              color: '#0071e3',
              textDecoration: 'none',
              fontSize: 14,
              fontWeight: 500,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            ← Back to Sign In
          </Link>
        </div>

        <h1 style={{
          fontSize: 32,
          fontWeight: 700,
          letterSpacing: '-0.02em',
          marginBottom: 12,
        }}>
          Gadzio Terms &amp; Conditions
        </h1>
        <p style={{ color: '#86868b', fontSize: 14, marginBottom: 36 }}>
          Last updated: September 2026
        </p>

        <section style={{ marginBottom: 32, lineHeight: 1.7, fontSize: 15, color: '#333336' }}>
          <h2 style={{ fontSize: 20, fontWeight: 600, color: '#1d1d1f', marginBottom: 12 }}>
            1. Acceptance of Terms
          </h2>
          <p>
            By accessing or using Gadzio websites, applications, and services, you agree to comply with and be bound by these Terms and Conditions. If you do not agree to these terms, please do not use our services.
          </p>
        </section>

        <section style={{ marginBottom: 32, lineHeight: 1.7, fontSize: 15, color: '#333336' }}>
          <h2 style={{ fontSize: 20, fontWeight: 600, color: '#1d1d1f', marginBottom: 12 }}>
            2. Accounts and Security
          </h2>
          <p>
            You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. Notify Gadzio immediately of any unauthorized use of your account.
          </p>
        </section>

        <section style={{ marginBottom: 32, lineHeight: 1.7, fontSize: 15, color: '#333336' }}>
          <h2 style={{ fontSize: 20, fontWeight: 600, color: '#1d1d1f', marginBottom: 12 }}>
            3. Intellectual Property
          </h2>
          <p>
            All content, graphics, user interfaces, visual interfaces, photographs, trademarks, logos, sounds, music, and computer code on this site are owned by, controlled by, or licensed to Gadzio, and are protected by trade dress, copyright, patent, and trademark laws. Apple, iPhone, iPad, Mac, AirPods, and MagSafe are trademarks of Apple Inc., registered in the U.S. and other countries. Gadzio is an independent retailer of compatible accessories and is not affiliated with, sponsored by, or endorsed by Apple Inc.
          </p>
        </section>

        <div style={{
          borderTop: '1px solid #e5e5ea',
          paddingTop: 24,
          marginTop: 40,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 13,
          color: '#86868b',
        }}>
          <span>© 2026 Gadzio. All rights reserved.</span>
          <Link href="/privacy" style={{ color: '#0071e3', textDecoration: 'none' }}>
            Privacy Policy
          </Link>
        </div>
      </div>
    </div>
  );
}
