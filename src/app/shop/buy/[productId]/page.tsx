import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ProductDetailPage } from '@/components/shop/ProductDetailPage';
import { recordProductView } from '@/lib/account/browsing-history';
import { getProductDetail } from '@/lib/storefront/catalog';
import { readSaleState } from '@/lib/storefront/sale-state';
import { getUserSession } from '@/lib/user-auth';
import { readTrustBarContent } from '@/lib/website/trust-bar';

interface Props {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{ model?: string; colour?: string }>;
}

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { productId } = await params;
  const detail = await getProductDetail(productId);

  if (!detail || detail.kind !== 'case') {
    return { title: 'Product Not Found | Gadzio Store' };
  }

  const product = detail.product;
  return {
    title: `Buy ${product.name} | Gadzio Store`,
    description: product.shortDescription ?? product.description,
    openGraph: {
      title: `Buy ${product.name} | Gadzio Store`,
      description: product.shortDescription ?? product.description,
      images: [product.image],
    },
  };
}

export default async function BuyPage({ params, searchParams }: Props) {
  const { productId } = await params;
  const query = await searchParams;
  const [detail, sale, session, trustBar] = await Promise.all([
    getProductDetail(productId),
    readSaleState(),
    getUserSession(),
    readTrustBarContent(),
  ]);

  // This route has always sold the bespoke case range only.
  if (!detail || detail.kind !== 'case') {
    notFound();
  }

  if (session) {
    // Record product view server-side for signed-in customer (debounced)
    void recordProductView(session.userId, detail.product.id);
  }

  return (
    <ProductDetailPage
      product={detail.product}
      saleLive={sale.live}
      inStock={detail.stock.inStock}
      initialModel={query.model ?? null}
      initialColour={query.colour ?? null}
      trustBar={trustBar}
    />
  );
}
