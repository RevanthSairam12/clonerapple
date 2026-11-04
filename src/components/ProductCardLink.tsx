import type { ReactNode } from 'react';
import Link from 'next/link';

export function ProductCardLink({ href, unavailable, className, children }: {
  href?: string;
  unavailable?: boolean;
  className: string;
  children: ReactNode;
}) {
  if (unavailable) return <div aria-disabled="true" className={className}>{children}</div>;
  return <Link href={href || '#'} className={className}>{children}</Link>;
}
