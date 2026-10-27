import type { Metadata } from 'next';
import { SearchPageView } from '@/components/search/SearchPageView';
import { getStorefrontRefs } from '@/lib/storefront/catalog';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ q?: string }>;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q } = await searchParams;
  return {
    title: q ? `Search results for "${q}" - Gadzio Store` : 'Search - Gadzio Store',
    description: 'Search premium accessories, MagSafe cases, Mac, and iPad.',
  };
}

export default async function SearchPage({ searchParams }: Props) {
  const { q } = await searchParams;
  const { products, saleLive } = await getStorefrontRefs();
  return (
    <SearchPageView
      initialQuery={q || ''}
      initialProducts={products}
      saleLive={saleLive}
    />
  );
}
