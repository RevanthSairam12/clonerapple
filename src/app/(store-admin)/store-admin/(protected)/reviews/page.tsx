import Link from 'next/link';

import { ReviewBoard } from '@/components/store-admin/ReviewBoard';
import { getStoreSession } from '@/lib/store-admin/auth';
import { isReviewStatus } from '@/lib/store-admin/review-rules';
import { listReviews } from '@/lib/store-admin/reviews';

export const dynamic = 'force-dynamic';

function href(status: string | null, q: string): string {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (q) params.set('q', q);
  const query = params.toString();
  return query ? `/store-admin/reviews?${query}` : '/store-admin/reviews';
}

/**
 * Review moderation. Pending is the working queue; published and rejected
 * stay reachable so a decision can be reversed with its reason on record.
 */
export default async function StoreAdminReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const params = await searchParams;
  const requested = params.status ?? '';
  const status = isReviewStatus(requested) ? requested : null;
  const q = (params.q ?? '').slice(0, 100);

  const session = await getStoreSession();
  const canEdit = session !== null && session.role !== 'store_viewer';

  const result = await listReviews({ status, search: q, limit: 200 });

  if (!result.ok) {
    return (
      <div>
        <h1 className="sa-page-title">Reviews</h1>
        <p className="sa-notice">
          Reviews are not available yet. Apply migration 0025, then reload this
          page.
        </p>
      </div>
    );
  }

  const { reviews, counts, total } = result.data;

  const filters = [
    { key: null, label: 'All', count: total },
    { key: 'pending', label: 'Pending', count: counts.pending },
    { key: 'published', label: 'Published', count: counts.published },
    { key: 'rejected', label: 'Rejected', count: counts.rejected },
  ] as const;

  return (
    <div>
      <div className="sa-detail-head">
        <div>
          <h1 className="sa-page-title">Reviews</h1>
          <p className="sa-page-sub">
            Customer reviews for every product. Publishing puts one on the
            product page; rejections keep their reason on record.
          </p>
        </div>
        <form className="sa-search-inline" action="/store-admin/reviews" method="get">
          {status ? <input type="hidden" name="status" value={status} /> : null}
          <input
            className="sa-input"
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search product, title or text"
            aria-label="Search reviews"
          />
          <button className="sa-btn sa-btn-small" type="submit">
            Search
          </button>
        </form>
      </div>

      <div className="sa-chip-row">
        {filters.map((filter) => {
          const active = status === filter.key;
          return (
            <Link
              key={filter.label}
              href={href(filter.key, q)}
              className={`sa-chip${active ? ' is-active' : ''}`}
            >
              {filter.label}
              <span className="sa-chip-count">{filter.count}</span>
            </Link>
          );
        })}
      </div>

      <ReviewBoard reviews={reviews} canEdit={canEdit} />
    </div>
  );
}
