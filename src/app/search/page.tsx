import type { Metadata } from 'next';
import { SearchPageView } from '@/components/search/SearchPageView';
import { getStorefrontRefs } from '@/lib/storefront/catalog';
import { readSeoPageOverride } from '@/lib/storefront/site-pages';
import { readTrustBarContent } from '@/lib/website/trust-bar';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ q?: string }>;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const [{ q }, seo] = await Promise.all([searchParams, readSeoPageOverride('search')]);
  return {
    title: q ? `Search results for "${q}" - Gadzio Store` : seo?.metaTitle || 'Search - Gadzio Store',
    description: seo?.metaDescription || 'Search premium accessories, MagSafe cases, Mac, and iPad.',
  };
}

export default async function SearchPage({ searchParams }: Props) {
  const [{ q }, { products, saleLive }, trustBar] = await Promise.all([
    searchParams,
    getStorefrontRefs(),
    readTrustBarContent(),
  ]);
  return (
    <SearchPageView
      initialQuery={q || ''}
      initialProducts={products}
      saleLive={saleLive}
      trustBar={trustBar}
    />
  );
}
