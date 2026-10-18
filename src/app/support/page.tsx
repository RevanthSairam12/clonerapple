import type { Metadata } from 'next';
import type { CSSProperties, ReactNode } from 'react';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Gadzio Support',
  description:
    'Get help with your Gadzio order — shipping, returns, payments, product support, and how to reach us.',
};

const cardStyle: CSSProperties = {
  maxWidth: 760,
  margin: '0 auto',
  backgroundColor: '#fff',
  borderRadius: 18,
  padding: '48px 40px',
  boxShadow: '0 2px 12px rgba(0, 0, 0, 0.04)',
};

const headingStyle: CSSProperties = {
  fontSize: 20,
  fontWeight: 600,
  color: '#1d1d1f',
  marginBottom: 12,
};

const bodyStyle: CSSProperties = {
  lineHeight: 1.7,
  fontSize: 15,
  color: '#333336',
};

const linkStyle: CSSProperties = {
  color: '#0071e3',
  textDecoration: 'none',
  fontWeight: 500,
};

const buttonStyle: CSSProperties = {
  display: 'inline-block',
  backgroundColor: '#0071e3',
  color: '#fff',
  padding: '10px 20px',
  borderRadius: 980,
  fontSize: 14,
  fontWeight: 500,
  textDecoration: 'none',
};

interface Action {
  label: string;
  href: string;
}

function SupportSection({
  id,
  title,
  children,
  actions,
}: {
  id: string;
  title: string;
  children: ReactNode;
  actions: Action[];
}) {
  return (
    <section id={id} style={{ marginBottom: 32 }}>
      <h2 style={headingStyle}>{title}</h2>
      <div style={bodyStyle}>{children}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 16 }}>
        {actions.map((action) => (
          <Link key={`${action.label}|${action.href}`} href={action.href} style={buttonStyle}>
            {action.label}
          </Link>
        ))}
      </div>
    </section>
  );
}

export default function SupportPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#f5f5f7',
        color: '#1d1d1f',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        padding: '48px 24px',
      }}
    >
      <div style={cardStyle}>
        <div style={{ marginBottom: 32 }}>
          <Link href="/" style={{ ...linkStyle, fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            ← Back to Home
          </Link>
        </div>

        <h1 style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 12 }}>
          Gadzio Support
        </h1>
        <p style={{ color: '#86868b', fontSize: 15, marginBottom: 36 }}>
          How can we help? Pick a topic below — every link goes to a real page you can act on right now.
        </p>

        <SupportSection
          id="order-help"
          title="Order Help"
          actions={[
            { label: 'Sign in to your account', href: '/auth' },
            { label: 'View your bag', href: '/bag' },
          ]}
        >
          <p>
            After checkout you&apos;ll see an on-screen confirmation with your payment reference, and you can
            review everything in your bag before you place an order. Sign in with the account you used at
            checkout to manage future orders. If a payment failed or was cancelled, the confirmation page
            explains what happened and lets you retry from the <a href="/checkout" style={linkStyle}>checkout</a>.
          </p>
        </SupportSection>

        <SupportSection
          id="shipping"
          title="Shipping & Delivery"
          actions={[{ label: 'Read the Terms of Use', href: '/terms' }]}
        >
          <p>
            We offer free delivery on all online orders across India, with standard dispatch within 24–48
            hours. Express courier service is available in select metropolitan pin codes. Delivery estimates
            shown on each product page apply at checkout.
          </p>
        </SupportSection>

        <SupportSection
          id="returns"
          title="Returns & Refunds"
          actions={[
            { label: 'Warranty & return terms', href: '/terms' },
            { label: 'Sign in to your account', href: '/auth' },
          ]}
        >
          <p>
            Eligible orders can be returned for a refund per the terms listed in our Terms of Use. Refunds
            are processed back to the original payment method via PayU and typically appear within 5–7
            business days. All cases, chargers, and protection accessories carry a 1-Year Limited
            Replacement Guarantee covering manufacturing defects.
          </p>
        </SupportSection>

        <SupportSection
          id="products"
          title="Product Support"
          actions={[
            { label: 'Cases & Protection', href: '/in/shop/iphone/accessories/cases-protection' },
            { label: 'Power Adapters & Cables', href: '/in/shop/iphone/accessories/power-adapter-cable' },
            { label: 'Wired Earphones', href: '/in/shop/iphone/accessories/wired-earphones' },
          ]}
        >
          <p>
            Each product page lists compatibility, materials, and what&apos;s in the box. Check the product
            page for your accessory — compatibility with MagSafe chargers, Qi2 wireless charging, and Apple
            devices varies by model. You can also <a href="/search" style={linkStyle}>search all products</a>{' '}
            or browse the <a href="/android" style={linkStyle}>Android store</a>.
          </p>
        </SupportSection>

        <SupportSection
          id="payments"
          title="Payment Help"
          actions={[{ label: 'Go to checkout', href: '/checkout' }]}
        >
          <p>
            Payments are securely processed via PayU Payment Solutions with 256-bit SSL encryption. We
            support UPI (Google Pay, PhonePe, Paytm), credit and debit cards, and NetBanking. If a payment
            was deducted but the order didn&apos;t complete, it is reconciled automatically and any excess
            is returned to the source account.
          </p>
        </SupportSection>

        <SupportSection
          id="contact"
          title="Contact Gadzio"
          actions={[
            { label: 'Sign in to your account', href: '/auth' },
            { label: 'Privacy questions', href: '/privacy' },
          ]}
        >
          <p>
            Most questions are answered by the topics above. Account and order issues are handled through
            your Gadzio account — sign in to see your orders, bag, and saved addresses. For questions about
            how we handle your data, read the <a href="/privacy" style={linkStyle}>Privacy Policy</a>.
          </p>
        </SupportSection>

        <div style={{ borderTop: '1px solid #e5e5ea', paddingTop: 24, marginTop: 8 }}>
          <Link href="/" style={{ ...linkStyle, fontSize: 14 }}>
            ← Back to the Gadzio store
          </Link>
        </div>
      </div>
    </div>
  );
}
