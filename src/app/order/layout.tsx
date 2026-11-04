import type { ReactNode } from 'react';
import { GlobalNav } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/GlobalNav';
import { GlobalFooter } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/GlobalFooter';

/** Storefront chrome also wraps missing-reference and access-denied result branches. */
export default function OrderLayout({ children }: { children: ReactNode }) {
  return <div className="gz-storefront-page flex min-h-screen flex-col bg-[#e8eaee] text-black" style={{ fontFamily: 'transducer, sans-serif' }}>
    <GlobalNav bannerVisible={false} />
    <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-10 sm:px-8 sm:py-14">{children}</main>
    <GlobalFooter />
  </div>;
}
