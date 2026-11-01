import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { WebsiteContentEditor } from '@/components/store-admin/website/WebsiteContentEditor';
import { getStoreSession } from '@/lib/store-admin/auth';
import { getContentRaw } from '@/lib/content';
import { getCollection } from '@/lib/website/collections';
import { getCollectionCurrentArt, getCollectionDefaults } from '@/lib/website/defaults';
import { canEditWebsite } from '@/lib/website/permissions';

export const dynamic = 'force-dynamic';

export default async function StoreAdminWebsiteContentKeyPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const session = await getStoreSession();
  if (!session) redirect('/store-admin/login');

  const { key } = await params;
  const collection = getCollection(decodeURIComponent(key));
  if (!collection) notFound();

  const [value, defaults, currentArt] = await Promise.all([
    getContentRaw<Record<string, unknown>>(collection.key),
    Promise.resolve(getCollectionDefaults(collection.key)),
    Promise.resolve(getCollectionCurrentArt(collection.key)),
  ]);

  return (
    <div>
      <Link className="sa-back" href="/store-admin/website/content">← Content</Link>
      <WebsiteContentEditor
        collection={collection}
        initialValue={value}
        defaults={defaults}
        currentArt={currentArt}
        canEdit={canEditWebsite(session.role)}
      />
    </div>
  );
}
