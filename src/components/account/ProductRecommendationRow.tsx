import Link from 'next/link';
import type { BrowsingHistoryItem } from '@/lib/account/browsing-history';

interface Props {
  title: string;
  subtitle?: string;
  items: BrowsingHistoryItem[];
  viewAllHref?: string;
}

export function ProductRecommendationRow({ title, subtitle, items, viewAllHref }: Props) {
  if (items.length === 0) return null;

  return (
    <section className="rounded-3xl border border-[#e5e5ea] bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          {subtitle && <p className="mt-1 text-sm text-[#6e6e73]">{subtitle}</p>}
        </div>
        {viewAllHref && (
          <Link
            href={viewAllHref}
            className="text-sm font-semibold text-[#0071e3] hover:underline focus:outline-none focus:ring-2 focus:ring-[#0071e3]"
          >
            View all
          </Link>
        )}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
        {items.map((item) => (
          <article
            key={item.id}
            className="flex flex-col justify-between rounded-2xl border border-[#e5e5ea] p-4 transition-all hover:border-[#d2d2d7]"
          >
            <div>
              <Link
                href={item.href}
                className="block h-36 w-full rounded-xl bg-[#f5f5f7] p-3 text-center focus:outline-none focus:ring-2 focus:ring-[#0071e3]"
              >
                {item.image ? (
                  <img
                    src={item.image}
                    alt=""
                    className="h-full w-full object-contain"
                    loading="lazy"
                  />
                ) : (
                  <div className="h-full w-full" />
                )}
              </Link>
              <h3 className="mt-3 font-semibold text-sm line-clamp-1">
                <Link href={item.href} className="hover:underline focus:outline-none focus:ring-2 focus:ring-[#0071e3]">
                  {item.name}
                </Link>
              </h3>
              <p className="mt-1 text-xs text-[#6e6e73] line-clamp-1">{item.subtitle}</p>
            </div>
            <div className="mt-3 flex items-baseline justify-between border-t border-[#f5f5f7] pt-2">
              <span className="text-sm font-semibold">{item.priceDisplay}</span>
              {item.onSale && item.wasPriceDisplay && (
                <span className="text-xs text-[#6e6e73] line-through">
                  {item.wasPriceDisplay}
                </span>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
