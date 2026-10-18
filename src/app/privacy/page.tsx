import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy - Gadzio',
  description: 'Learn how Gadzio protects your privacy and personal data.',
};

export default function PrivacyPage() {
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
          Gadzio Privacy Policy
        </h1>
        <p style={{ color: '#86868b', fontSize: 14, marginBottom: 36 }}>
          Last updated: September 2026
        </p>

        <section style={{ marginBottom: 32, lineHeight: 1.7, fontSize: 15, color: '#333336' }}>
          <h2 style={{ fontSize: 20, fontWeight: 600, color: '#1d1d1f', marginBottom: 12 }}>
            Your Privacy Matters
          </h2>
          <p>
            At Gadzio, we treat any information that relates to an identified or identifiable individual as personal data. This policy explains what we collect when you shop with us, why we collect it, and the choices you have.
          </p>
        </section>

        <section style={{ marginBottom: 32, lineHeight: 1.7, fontSize: 15, color: '#333336' }}>
          <h2 style={{ fontSize: 20, fontWeight: 600, color: '#1d1d1f', marginBottom: 12 }}>
            Personal Data We Collect from You
          </h2>
          <p>
            When you create a Gadzio account, sign in, or place an order, we collect information such as your name, email address, phone number, delivery address, and payment reference so we can provide a secure and reliable shopping experience.
          </p>
        </section>

        <section style={{ marginBottom: 32, lineHeight: 1.7, fontSize: 15, color: '#333336' }}>
          <h2 style={{ fontSize: 20, fontWeight: 600, color: '#1d1d1f', marginBottom: 12 }}>
            How We Use Personal Data
          </h2>
          <p>
            Gadzio uses personal data to process your orders, deliver your purchases, provide customer support, prevent fraud, and comply with law. We do not sell your personal data.
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
          <Link href="/terms" style={{ color: '#0071e3', textDecoration: 'none' }}>
            Terms &amp; Conditions
          </Link>
        </div>
      </div>
    </div>
  );
}
