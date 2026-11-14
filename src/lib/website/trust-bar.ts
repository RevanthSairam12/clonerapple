import { getContent } from '@/lib/content';
import type { GadzioTrustBarProps, TrustBadgeItem } from '@/components/trust/GadzioTrustBar';

export interface TrustBarContent {
  enabled?: boolean;
  items?: TrustBadgeItem[];
}

/**
 * Shared server helper for the storefront Trust Badges Bar (`gadzio.trust_badges`).
 * Returns normalized props matching homepage behavior so admin edits immediately
 * apply across product, collection, sale, search, and home pages.
 */
export async function readTrustBarContent(): Promise<GadzioTrustBarProps> {
  const data = await getContent<TrustBarContent>('gadzio.trust_badges', {});
  return {
    items: Array.isArray(data?.items) ? data.items : undefined,
    enabled: data?.enabled,
  };
}
