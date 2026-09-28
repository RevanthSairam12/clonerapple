/**
 * Admin override shapes for the Education Store page. The admin editor stores
 * these under the edu.* content keys; EduStorePage receives them and merges
 * over the hardcoded defaults from ./data/content.
 */

export interface EduHeroOverride {
  badge?: string;
  headline?: string;
  subhead?: string;
  promoHeadline?: string;
  promoOffer?: string;
  promoDisclaimer?: string;
}

export interface EduOfferItemOverride {
  kicker?: string;
  headline?: string;
  offer?: string;
  upgradeNote?: string;
  image?: string;
  ctaPrimaryLabel?: string;
  ctaPrimaryHref?: string;
  ctaSecondaryLabel?: string;
  ctaSecondaryHref?: string;
}

export interface EduProductOverride {
  name?: string;
  descriptor?: string;
  chip?: string;
  price?: string;
  priceNote?: string;
  image?: string;
  buyHref?: string;
  learnHref?: string;
}

export interface EduSectionHeadingsOverride {
  mac?: { eyebrow?: string; headline?: string; subhead?: string };
  ipad?: { eyebrow?: string; headline?: string; subhead?: string };
  action?: { eyebrow?: string; headline?: string; subhead?: string };
  categories?: { headline?: string };
}

export interface EduInActionItemOverride {
  field?: string;
  device?: string;
  headline?: string;
  body?: string;
  app?: string;
}

export interface EduEligibilityOverride {
  headline?: string;
  body?: string;
  tags?: string;
  ctaLabel?: string;
  ctaHref?: string;
}

export interface EduStepOverride {
  step?: string;
  headline?: string;
  body?: string;
  linkLabel?: string;
  linkHref?: string;
}

export interface EduCategoryOverride {
  label?: string;
  icon?: string;
  href?: string;
}
