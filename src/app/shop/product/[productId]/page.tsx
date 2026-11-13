import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ProductDetailPage } from '@/components/shop/ProductDetailPage';
import { AccessoryDetailPage } from '@/components/sites/accessories/AccessoryDetailPage';
import { recordProductView } from '@/lib/account/browsing-history';
import { listProductPageGiftPromos } from '@/lib/free-gifts/store';
import { getProductDetail } from '@/lib/storefront/catalog';
import { siteOpenGraphUrl } from '@/lib/storefront/metadata';
import { readSaleState } from '@/lib/storefront/sale-state';
import { getUserSession } from '@/lib/user-auth';

interface Props {
  params: Promise<{ productId: string }>;
  /** A shared link restores the model and colour chosen on the product page. */
  searchParams: Promise<{ model?: string; colour?: string }>;
}

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { productId } = await params;
  const detail = await getProductDetail(productId);

  if (!detail) {
    return {
      title: 'Product Not Found | Gadzio Store',
    };
  }

  const product = detail.product;
  const ogUrl = siteOpenGraphUrl(`/shop/product/${product.id}`);
  return {
    title: `${product.name} | Gadzio Store`,
    description: product.shortDescription ?? product.description,
    openGraph: {
      title: `${product.name} | Gadzio Store`,
      description: product.shortDescription ?? product.description,
      images: [product.image],
      ...(ogUrl ? { url: ogUrl } : {}),
      siteName: 'Gadzio',
    },
  };
}

export default async function ProductPage({ params, searchParams }: Props) {
  const { productId } = await params;
  const query = await searchParams;
  const [detail, sale, session, giftPromos] = await Promise.all([
    getProductDetail(productId),
    readSaleState(),
    getUserSession(),
    listProductPageGiftPromos(),
  ]);

  if (!detail) notFound();

  if (session) {
    // Record product view server-side for signed-in customer (debounced)
    void recordProductView(session.userId, detail.product.id);
  }

  // Original iPhone cases keep their polished, bespoke detail page.
  if (detail.kind === 'case') {
    return (
      <ProductDetailPage
        product={detail.product}
        saleLive={sale.live}
        inStock={detail.stock.inStock}
        initialModel={query.model ?? null}
        initialColour={query.colour ?? null}
        giftPromos={giftPromos}
      />
    );
  }

  // Every other accessory category renders the generic, data-driven page.
  return (
    <AccessoryDetailPage
      product={detail.product}
      saleLive={sale.live}
      inStock={detail.stock.inStock}
      initialModel={query.model ?? null}
      initialColour={query.colour ?? null}
      giftPromos={giftPromos}
    />
  );
}
