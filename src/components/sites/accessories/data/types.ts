// Shared types + helpers for the generic Accessories storefront.
// One config-driven bundle powers all accessory category pages (power adapters,
// wired earphones, cable & plug cases, AirPods cases, mobile cases) so the
// polished cases-protection experience stays untouched.
// Prices in INR (₹). These are the authoritative records consumed by the
// product-detail route, PayU checkout catalog, and site search.

export interface ColorSwatch {
  name: string;
  hex: string;
}

export interface SpecRow {
  label: string;
  value: string;
}

export interface ProductHighlight {
  title: string;
  desc: string;
}

export interface AccessoryProduct {
  id: string;
  name: string;
  subtitle: string;
  price: number;
  priceDisplay: string;
  image: string;
  /** Optional extra gallery images; falls back to [image] when omitted. */
  images: string[];
  colors: ColorSwatch[];
  /** Devices / things this item is compatible with (shown on the detail page). */
  compatibility: string[];
  /** Generic material/finish label (used as a search badge). */
  material: string;
  /** Generic brand label (used as a search badge + filter). */
  brand: string;
  /** Human category name, e.g. "Power Adapter & Cable". */
  category: string;
  /** URL slug of the owning category, e.g. "power-adapter-cable". */
  categorySlug: string;
  /** Facet id -> value map, e.g. { wattage: "20W", connector: "USB-C" }. */
  facets: Record<string, string>;
  features: string[];
  description: string;
  highlights: ProductHighlight[];
  specs: SpecRow[];
  inTheBox: string[];
  href: string;
}

/** A single filter group in the sidebar (and the facet it reads from). */
export interface FacetDef {
  /** Key into AccessoryProduct.facets. */
  id: string;
  /** Display label, e.g. "Wattage". */
  label: string;
  /** Selectable values. */
  options: string[];
}

export interface CategoryLink {
  label: string;
  href: string;
  active?: boolean;
}

/** Canonical accessories sub-navigation, shared by every category page. */
export const ACCESSORY_NAV: { slug: string; label: string; href: string }[] = [
  { slug: 'cases-protection', label: 'Cases & Protection', href: '/in/shop/iphone/accessories/cases-protection' },
  { slug: 'mobile-cases', label: 'Mobile Cases', href: '/in/shop/iphone/accessories/mobile-cases' },
  { slug: 'power-adapter-cable', label: 'Power & Cables', href: '/in/shop/iphone/accessories/power-adapter-cable' },
  { slug: 'wired-earphones', label: 'Wired Earphones', href: '/in/shop/iphone/accessories/wired-earphones' },
  { slug: 'cable-plug-case', label: 'Cable & Plug Case', href: '/in/shop/iphone/accessories/cable-plug-case' },
  { slug: 'airpods-case', label: 'AirPods Cases', href: '/in/shop/iphone/accessories/airpods-case' },
];

/** Builds the sub-nav with the given slug marked active. */
export function buildCategoryLinks(activeSlug: string): CategoryLink[] {
  return ACCESSORY_NAV.map((n) => ({
    label: n.label,
    href: n.href,
    active: n.slug === activeSlug,
  }));
}

export interface SortOption {
  label: string;
  value: string;
}

export const SORT_OPTIONS: SortOption[] = [
  { label: 'Featured', value: 'featured' },
  { label: 'Price: Low to High', value: 'price-asc' },
  { label: 'Price: High to Low', value: 'price-desc' },
  { label: 'Newest Arrivals', value: 'newest' },
];

export interface CategoryConfig {
  slug: string;
  /** H1 / page title. */
  title: string;
  /** One-line description under the title. */
  subhead: string;
  /** Leaf label for the breadcrumb trail. */
  breadcrumbLeaf: string;
  /** Noun used in the "Showing N <noun>" banner, e.g. "power accessories". */
  countNoun: string;
  /** Sub-navigation links across the top of the catalog. */
  categoryLinks: CategoryLink[];
  /** Sidebar filter groups. */
  filters: FacetDef[];
  /** Facet id the quick-pill row toggles (optional). */
  quickPillFacet?: string;
  /** Quick-pill values shown above the grid (optional). */
  quickPills?: string[];
  /** Fair-use / trademark disclaimer shown at the bottom. */
  disclaimer: string;
  seo: { title: string; description: string };
}

/**
 * Fills the derived fields (priceDisplay, features, href, images, inTheBox)
 * so category data files stay concise.
 */
export function buildAccessoryProduct(input: {
  id: string;
  name: string;
  subtitle: string;
  price: number;
  image: string;
  images?: string[];
  colors?: ColorSwatch[];
  compatibility: string[];
  material: string;
  brand: string;
  category: string;
  categorySlug: string;
  facets: Record<string, string>;
  description: string;
  highlights: ProductHighlight[];
  specs: SpecRow[];
  inTheBox?: string[];
}): AccessoryProduct {
  return {
    id: input.id,
    name: input.name,
    subtitle: input.subtitle,
    price: input.price,
    priceDisplay: `₹${input.price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
    image: input.image,
    images: input.images && input.images.length > 0 ? input.images : [input.image],
    colors: input.colors ?? [],
    compatibility: input.compatibility,
    material: input.material,
    brand: input.brand,
    category: input.category,
    categorySlug: input.categorySlug,
    facets: input.facets,
    features: input.highlights.map((h) => h.title),
    description: input.description,
    highlights: input.highlights,
    specs: input.specs,
    inTheBox:
      input.inTheBox ?? [
        `1x ${input.name}`,
        '1x Quick Start & Safety Guide',
        '1x 1-Year Gadzio Warranty Card',
      ],
    href: `/shop/product/${input.id}`,
  };
}
