'use client';

import React from 'react';
import Link from 'next/link';

export interface CollectionPaginationProps {
  totalItems: number;
  pageSize?: number;
  currentPage?: number;
  baseHref?: string;
}

export function CollectionPagination({
  totalItems,
  pageSize = 24,
  currentPage = 1,
  baseHref = '',
}: CollectionPaginationProps) {
  const totalPages = Math.ceil(totalItems / pageSize);

  // Requirement: render only if products exceed one page (page size 24)
  if (totalPages <= 1) {
    return null;
  }

  const pages = Array.from({ length: totalPages }, (_, i) => i + 1);

  const getPageUrl = (page: number) => {
    if (!baseHref) return `?page=${page}`;
    const sep = baseHref.includes('?') ? '&' : '?';
    return `${baseHref}${sep}page=${page}`;
  };

  return (
    <nav className="flex items-center justify-center gap-2 pt-12 pb-6" aria-label="Pagination Navigation">
      {currentPage > 1 && (
        <Link
          href={getPageUrl(currentPage - 1)}
          className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center px-4 rounded-full border border-[#d2d2d7] text-sm font-medium text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors"
          aria-label="Go to previous page"
        >
          Previous
        </Link>
      )}

      {pages.map((p) => {
        const isCurrent = p === currentPage;
        return (
          <Link
            key={p}
            href={getPageUrl(p)}
            className={`min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-full text-sm font-semibold transition-colors ${
              isCurrent
                ? 'bg-[#1d1d1f] text-white'
                : 'text-[#1d1d1f] hover:bg-[#f5f5f7]'
            }`}
            aria-current={isCurrent ? 'page' : undefined}
            aria-label={`Page ${p}`}
          >
            {p}
          </Link>
        );
      })}

      {currentPage < totalPages && (
        <Link
          href={getPageUrl(currentPage + 1)}
          className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center px-4 rounded-full border border-[#d2d2d7] text-sm font-medium text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors"
          aria-label="Go to next page"
        >
          Next
        </Link>
      )}
    </nav>
  );
}
