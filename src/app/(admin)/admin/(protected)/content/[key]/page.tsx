import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CollectionEditor } from '@/components/admin/CollectionEditor';
import { getCollection } from '@/lib/admin/collections';
import { getCollectionDefaults, getCollectionCurrentArt } from '@/lib/admin/defaults';
import { getContentRaw } from '@/lib/content';

export const dynamic = 'force-dynamic';

export default async function AdminCollectionPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  const collection = getCollection(key);
  if (!collection) notFound();

  const [value, defaults, currentArt] = await Promise.all([
    getContentRaw<Record<string, unknown>>(collection.key),
    Promise.resolve(getCollectionDefaults(collection.key)),
    Promise.resolve(getCollectionCurrentArt(collection.key)),
  ]);

  return (
    <div>
      <div className="admin-topbar">
        <div style={{ minWidth: 0 }}>
          <h1 className="admin-topbar-title">
            <Link
              href="/admin"
              style={{ color: '#0071e3', textDecoration: 'none', fontSize: 15, fontWeight: 600 }}
            >
              ←
            </Link>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {collection.label}
            </span>
          </h1>
        </div>
      </div>
      <div className="admin-content">
        <CollectionEditor collection={collection} initialValue={value} defaults={defaults} currentArt={currentArt} />
      </div>
    </div>
  );
}
