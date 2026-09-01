import type { Metadata } from 'next';

import { EduStorePage } from '@/components/sites/edu-store/EduStorePage';

import './edu-store.css';

export const metadata: Metadata = {
  title: 'Apple Education Store India — Back to School 2026',
  description:
    'Shop Mac and iPad with Apple Education Pricing. Students, teachers, and educators get exclusive savings plus get AirPods with Mac and Apple Pencil Pro with iPad — for a limited time.',
  openGraph: {
    title: 'Apple Education Store India',
    description: 'Education pricing on Mac, iPad, and more. Back to School offer ends 24 September 2026.',
    url: 'https://www.apple.com/in-edu/store',
    siteName: 'Apple',
    locale: 'en_IN',
    type: 'website',
  },
  icons: {
    icon: '/sites/www-apple-com-736d3707/root-8a5edab2/seo/favicon.ico',
  },
};

export default function Page() {
  return <EduStorePage />;
}
