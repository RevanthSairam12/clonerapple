/**
 * Admin override shapes for the Cases & Protection page. The admin editor
 * stores these under the cases.* content keys; CasesProtectionPage receives
 * them and merges over the hardcoded defaults from ./data/products.
 */

export interface CasesCategoryLinkOverride {
  label?: string;
  href?: string;
}

export interface CasesProductOverride {
  name?: string;
  subtitle?: string;
  /** Numeric price in ₹, used for sorting. */
  price?: number;
  priceDisplay?: string;
  image?: string;
  badge?: string;
  href?: string;
}

export interface CasesPageHeaderOverride {
  title?: string;
  sortLabel?: string;
}
