/**
 * Admin override shapes for the OPPO India site. Each interface mirrors what
 * the admin editor stores for the oppo.* content keys; components receive
 * them as optional props and fall back to their hardcoded values.
 */

export interface OppoAnnounceOverride {
  text?: string;
  linkLabel?: string;
  linkHref?: string;
}

export interface OppoNavLink {
  label?: string;
  href?: string;
}

export interface OppoNavOverride {
  logoText?: string;
  leftLinks?: OppoNavLink[];
  rightLinks?: OppoNavLink[];
}

export interface OppoSlideOverride {
  title?: string;
  subtitle?: string;
  image?: string;
  bg?: string;
  learnMoreHref?: string;
  buyNowHref?: string;
}

export interface OppoHotSaleOverride {
  badge?: string;
  title?: string;
  tagline?: string;
  image?: string;
  learnLabel?: string;
  buyLabel?: string;
}

export interface OppoProductOverride {
  title?: string;
  titleSup?: string;
  image?: string;
  /** string[] as used internally, or a newline-separated string as stored by the admin editor. */
  descriptions?: string[] | string;
  learnHref?: string;
  buyHref?: string;
}

export interface OppoOfferOverride {
  title?: string;
  description?: string;
  image?: string;
  href?: string;
}

export interface OppoExploreOverride {
  title?: string;
  description?: string;
  image?: string;
  href?: string;
}

export interface OppoCommunityCardOverride {
  title?: string;
  subtitle?: string;
  /** Uploaded image; replaces the gradient placeholder when set. */
  image?: string;
}

export interface OppoCommunityOverride {
  heading?: string;
  viewAllLabel?: string;
  tagline?: string;
  cards?: OppoCommunityCardOverride[];
}

export interface OppoFooterOverride {
  disclaimer1?: string;
  disclaimer2?: string;
  disclaimer3?: string;
  tagline?: string;
}
