import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ProductDetailPage } from '@/components/shop/ProductDetailPage';
import { AccessoryDetailPage } from '@/components/sites/accessories/AccessoryDetailPage';
import { WaitlistPanel } from '@/components/waitlist/WaitlistPanel';
import { getProductDetail } from '@/lib/storefront/catalog';
import { getUserSession } from '@/lib/user-auth';
import { getWaitlistPanelState } from '@/lib/waitlist/store';

interface Props {
  params: Promise<{ productId: string }>;
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
  return {
    title: `${product.name} | Gadzio Store`,
    description: product.description,
    openGraph: {
      title: `${product.name} | Gadzio Store`,
      description: product.description,
      images: [product.image],
      url: `https://gadzio.in/shop/product/${product.id}`,
      siteName: 'Gadzio',
    },
  };
}

export default async function ProductPage({ params }: Props) {
  const { productId } = await params;
  const detail = await getProductDetail(productId);

  if (!detail) notFound();

  const session = await getUserSession();
  const waitlist = await getWaitlistPanelState({
    userId: session?.userId ?? null,
    productId: detail.product.id,
  });
  const entryStatus: 'ACTIVE' | 'INVITED' | null =
    waitlist.entry?.status === 'ACTIVE'
      ? 'ACTIVE'
      : waitlist.entry?.status === 'INVITED'
        ? 'INVITED'
        : null;
  const waitlistSlot = (
    <WaitlistPanel
      productId={detail.product.id}
      signedIn={Boolean(session)}
      signInHref={`/auth?redirect=${encodeURIComponent(`/shop/product/${encodeURIComponent(detail.product.id)}`)}`}
      initial={{
        waitlistEnabled: waitlist.waitlistEnabled,
        joinable: waitlist.joinable,
        entryStatus,
      }}
    />
  );

  // Original iPhone cases keep their polished, bespoke detail page.
  if (detail.kind === 'case') {
    return <ProductDetailPage product={detail.product} waitlistSlot={waitlistSlot} />;
  }

  // Every other accessory category renders the generic, data-driven page.
  return <AccessoryDetailPage product={detail.product} waitlistSlot={waitlistSlot} />;
}
