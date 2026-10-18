// De-branded in the Gadzio cleanup pass. This file was generated verbatim from
// apple.com, so its copy and every destination were Apple's — the banner told
// shoppers to pick a region and then sent them to apple.com's country picker.
// The shape is unchanged (the component reads the same fields), but the wording
// is Gadzio's own and the only destination is Gadzio's own storefront.
//
// `options` carries a single entry because Gadzio ships a single locale. The
// former second entry ("Other country or region" → apple.com/choose-country-region)
// had no Gadzio equivalent, and pointing two options at the same href would also
// collide on the component's `key={option.href}`.

export interface LocaleOption {
  label: string;
  href: string;
}

export const LOCALE_BANNER: {
  lang: string;
  ariaLabel: string;
  copy: string;
  selectedLabel: string;
  options: LocaleOption[];
  continueLabel: string;
  continueHref: string;
  closeLabel: string;
} = {
  "lang": "en-IN",
  "ariaLabel": "Choose country or region",
  "copy": "You're shopping with Gadzio India. Choose your region to see local pricing, delivery options and offers.",
  "selectedLabel": "India",
  "options": [
    {
      "label": "India",
      "href": "/"
    }
  ],
  "continueLabel": "Continue",
  "continueHref": "/",
  "closeLabel": "Close country or region selector"
};
