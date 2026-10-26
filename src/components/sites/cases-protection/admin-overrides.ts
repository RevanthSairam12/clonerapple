/**
 * Admin override shapes for the Cases & Protection page furniture.
 *
 * The legacy editor may change the page title, the sort label and the
 * category-link rail. Products, prices, images and stock are deliberately
 * absent: the grid comes from `products` and is edited in Store Admin.
 */

export interface CasesCategoryLinkOverride {
  label?: string;
  href?: string;
}

export interface CasesPageHeaderOverride {
  title?: string;
  sortLabel?: string;
}
