import type { Metadata } from 'next';

import { EduStorePage } from '@/components/sites/edu-store/EduStorePage';
import type { EduStoreOverrides } from '@/components/sites/edu-store/EduStorePage';
import { getContent, getContentMany } from '@/lib/content';

import './edu-store.css';

/** Admin edits must appear without a rebuild, so render per-request. */
export const dynamic = 'force-dynamic';

/** Shelf id → content_blocks key (one admin collection per shelf). */
export const SHELF_KEYS: Record<string, string> = {
  savings: 'edu.shelf_savings',
  'ways-to-save': 'edu.shelf_ways_to_save',
  difference: 'edu.shelf_difference',
  accessories: 'edu.shelf_accessories',
  potential: 'edu.shelf_potential',
  'more-to-love': 'edu.shelf_more_to_love',
  experience: 'edu.shelf_experience',
};

const metadata: Metadata = {
  title: 'Education Pricing and Student Discounts — Gadzio Education Store (IN)',
  description:
    'College, sorted. Buy Gadzio Book, Pad and more with education pricing. Students, parents and educators save on computers, tablets, watches and accessories.',
  openGraph: {
    title: 'Gadzio Education Store (IN)',
    description: 'College, sorted. Education pricing on computers, tablets and more.',
    url: 'https://www.gadzio.in/in-edu/store',
    siteName: 'Gadzio',
    locale: 'en_IN',
    type: 'website',
  },
  icons: {
    icon: '/gadzio_logo.png',
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
      title: seo.title ?? 'Gadzio Education Store (IN)',
      description: seo.description ?? metadata.openGraph?.description,
    },
  };
}

type ShelfValue = NonNullable<EduStoreOverrides['shelves']>[string];

export default async function Page() {
  const c = await getContentMany({
    hero: ['edu.hero', {}],
    productNav: ['edu.product_nav', {}],
    quickLinks: ['edu.quick_links', {}],
    savings: [SHELF_KEYS.savings, {}],
    waysToSave: [SHELF_KEYS['ways-to-save'], {}],
    difference: [SHELF_KEYS.difference, {}],
    accessories: [SHELF_KEYS.accessories, {}],
    potential: [SHELF_KEYS.potential, {}],
    moreToLove: [SHELF_KEYS['more-to-love'], {}],
    experience: [SHELF_KEYS.experience, {}],
  });

  const shelves: Record<string, ShelfValue> = {};
  for (const [id, key] of Object.entries(SHELF_KEYS)) {
    const name = {
      savings: 'savings',
      'ways-to-save': 'waysToSave',
      difference: 'difference',
      accessories: 'accessories',
      potential: 'potential',
      'more-to-love': 'moreToLove',
      experience: 'experience',
    }[id] as keyof typeof c;
    const value = c[name] as { headline?: string; subhead?: string; enabled?: boolean; cards?: ShelfValue['cards'] };
    shelves[id] = {
      headline: value.headline,
      subhead: value.subhead,
      enabled: value.enabled !== false,
      cards: value.cards,
    };
    void key;
  }

  const overrides: EduStoreOverrides = {
    hero: c.hero as EduStoreOverrides['hero'],
    productNav: (c.productNav as { items?: EduStoreOverrides['productNav'] }).items,
    shelves,
    quickLinks: (c.quickLinks as { items?: EduStoreOverrides['quickLinks'] }).items,
  };

  return <EduStorePage overrides={overrides} />;
}
