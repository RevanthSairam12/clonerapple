import type { Metadata } from 'next';

import { EduStorePage } from '@/components/sites/edu-store/EduStorePage';
import type { EduStoreOverrides } from '@/components/sites/edu-store/EduStorePage';
import type { EduStepOverride } from '@/components/sites/edu-store/admin-overrides';
import { getContent, getContentMany } from '@/lib/content';

import './edu-store.css';

/** Admin edits must appear without a rebuild, so render per-request. */
export const dynamic = 'force-dynamic';

const metadata: Metadata = {
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

export async function generateMetadata(): Promise<Metadata> {
  const seo = await getContent<{ title?: string; description?: string }>('edu.seo', {});
  return {
    ...metadata,
    title: seo.title ?? metadata.title,
    description: seo.description ?? metadata.description,
    openGraph: {
      ...metadata.openGraph,
      title: seo.title ?? 'Apple Education Store India',
      description: seo.description ?? metadata.openGraph?.description,
    },
  };
}

export default async function Page() {
  const c = await getContentMany({
    hero: ['edu.hero', {}],
    btsOffers: ['edu.bts_offers', {}],
    macProducts: ['edu.mac_products', {}],
    ipadProducts: ['edu.ipad_products', {}],
    sections: ['edu.sections', {}],
    inAction: ['edu.in_action', {}],
    eligibility: ['edu.eligibility', {}],
    howToBuy: ['edu.how_to_buy', {}],
    categories: ['edu.categories', {}],
  });

  const overrides: EduStoreOverrides = {
    hero: c.hero as EduStoreOverrides['hero'],
    btsOffers: (c.btsOffers as { items?: EduStoreOverrides['btsOffers'] }).items,
    btsEnabled: (c.btsOffers as { enabled?: boolean }).enabled !== false,
    macProducts: (c.macProducts as { items?: EduStoreOverrides['macProducts'] }).items,
    macEnabled: (c.macProducts as { enabled?: boolean }).enabled !== false,
    ipadProducts: (c.ipadProducts as { items?: EduStoreOverrides['ipadProducts'] }).items,
    ipadEnabled: (c.ipadProducts as { enabled?: boolean }).enabled !== false,
    sections: c.sections as EduStoreOverrides['sections'],
    inAction: (c.inAction as { items?: EduStoreOverrides['inAction'] }).items,
    inActionEnabled: (c.inAction as { enabled?: boolean }).enabled !== false,
    eligibility: c.eligibility as EduStoreOverrides['eligibility'],
    eligibilityEnabled: (c.eligibility as { enabled?: boolean }).enabled !== false,
    howToBuy: {
      eyebrow: (c.howToBuy as { eyebrow?: string }).eyebrow,
      headline: (c.howToBuy as { headline?: string }).headline,
      steps: (c.howToBuy as { steps?: EduStepOverride[] }).steps,
    },
    howToBuyEnabled: (c.howToBuy as { enabled?: boolean }).enabled !== false,
    categories: (c.categories as { items?: EduStoreOverrides['categories'] }).items,
    categoriesEnabled: (c.categories as { enabled?: boolean }).enabled !== false,
  };

  return <EduStorePage overrides={overrides} />;
}
