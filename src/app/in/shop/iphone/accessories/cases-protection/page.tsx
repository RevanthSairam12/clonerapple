import type { Metadata } from 'next';

import { CasesProtectionPage } from '@/components/sites/cases-protection/CasesProtectionPage';

import './cases.css';

export const metadata: Metadata = {
  title: 'Cases & Protection - iPhone Accessories - Apple (IN)',
  description:
    'Shop iPhone cases and protection from Apple. Find MagSafe cases, silicone cases, clear cases, FineWoven cases and more for iPhone 17, iPhone 17 Pro, iPhone 16 and more.',
  openGraph: {
    title: 'Cases & Protection - iPhone Accessories - Apple (IN)',
    description: 'Shop iPhone cases from Apple India.',
    url: 'https://www.apple.com/in/shop/iphone/accessories/cases-protection',
    siteName: 'Apple',
    locale: 'en_IN',
    type: 'website',
  },
  icons: {
    icon: '/sites/www-apple-com-736d3707/root-8a5edab2/seo/favicon.ico',
  },
};

export default function Page() {
  return <CasesProtectionPage />;
}
