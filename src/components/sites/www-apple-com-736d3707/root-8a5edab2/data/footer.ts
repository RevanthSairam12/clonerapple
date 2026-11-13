// Hand-maintained Gadzio footer content (de-brand pass).
// Directory links must only ever point at routes that exist in this app —
// see the build's route manifest; no apple.com destinations may be added back.

export interface FooterLink {
  label: string;
  href: string;
}

export interface FooterSection {
  title: string;
  links: FooterLink[];
}

export interface FooterColumn {
  sections: FooterSection[];
}

/** Legal footnotes — localized Gadzio store disclaimers (warranty, India shipping, PayU checkout). */
export const FOOTER_FOOTNOTES: { index: number; html: string }[] = [
  {
    "index": 0,
    "html": "<small>*</small> Domestic orders are typically delivered in 5–7 business days (subject to internal or external factors). Shipping charges apply based on order amount and are displayed at checkout."
  },
  {
    "index": 1,
    "html": "Trade-in values and exchange bonuses vary based on the condition, year, and configuration of your eligible trade-in device. Devices are evaluated at delivery or via authorized partner. Terms and conditions apply."
  },
  {
    "index": 2,
    "html": "Gadzio does not provide a store warranty of its own. Warranty is subject to the product, and where applicable is officially provided directly by the respective brand. Compatibility varies by model — check each product page for supported devices."
  },
  {
    "index": 3,
    "html": "Payments are securely processed via PayU Payment Solutions with 256-bit SSL encryption. All major UPI applications (Google Pay, PhonePe, Paytm), credit/debit cards, and NetBanking are supported."
  },
  {
    "index": 4,
    "html": "Product specifications, pricing in Indian Rupees (₹), and promotional offers are subject to change without notice."
  }
];

/** The whole .gz-gf-sosumi block, verbatim — its ul/ol nesting sets its height. */
export const FOOTER_FOOTNOTES_HTML = "<ul> <li id=\"footnote-asterisk-1\"> <small>*</small> Domestic orders are typically delivered in 5–7 business days (subject to internal or external factors). Shipping charges apply based on order amount and are displayed at checkout. </li> </ul> <ol> <li id=\"footnote-1\">Trade-in values and exchange bonuses vary based on the condition, year, and configuration of your eligible trade-in device. Devices are evaluated at delivery or via authorized partner. Terms and conditions apply.</li> <li id=\"footnote-2\">Gadzio does not provide a store warranty of its own. Warranty is subject to the product, and where applicable is officially provided directly by the respective brand. Compatibility varies by model — check each product page for supported devices.</li> <li id=\"footnote-3\">Payments are securely processed via PayU Payment Solutions with 256-bit SSL encryption. All major UPI applications (Google Pay, PhonePe, Paytm), credit/debit cards, and NetBanking are supported.</li> </ol> <ul> <li>Product specifications, pricing in Indian Rupees (₹), and promotional offers are subject to change without notice.</li> </ul>";

export const FOOTER_DIRECTORY: FooterColumn[] = [
  {
    "sections": [
      {
        "title": "Shop",
        "links": [
          {
            "label": "Search All Products",
            "href": "/search"
          },
          {
            "label": "Cases & Protection",
            "href": "/in/shop/iphone/accessories/cases-protection"
          },
          {
            "label": "Buds Cases",
            "href": "/in/shop/iphone/accessories/airpods-case"
          },
          {
            "label": "Cable & Plug Cases",
            "href": "/in/shop/iphone/accessories/cable-plug-case"
          },
          {
            "label": "Mobile Cases",
            "href": "/in/shop/iphone/accessories/mobile-cases"
          },
          {
            "label": "Power Adapters & Cables",
            "href": "/in/shop/iphone/accessories/power-adapter-cable"
          },
          {
            "label": "Wired Earphones",
            "href": "/in/shop/iphone/accessories/wired-earphones"
          }
        ]
      }
    ]
  },
  {
    "sections": [
      {
        "title": "Support",
        "links": [
          {
            "label": "Gadzio Support",
            "href": "/support"
          },
          {
            "label": "Order Help",
            "href": "/support#order-help"
          },
          {
            "label": "Shipping & Delivery",
            "href": "/shipping-policy"
          },
          {
            "label": "Returns & Refunds",
            "href": "/return-refund"
          },
          {
            "label": "Payment Help",
            "href": "/support#payments"
          },
          {
            "label": "Contact Gadzio",
            "href": "/support#contact"
          }
        ]
      }
    ]
  },
  {
    "sections": [
      {
        "title": "Account",
        "links": [
          {
            "label": "Sign In",
            "href": "/auth"
          },
          {
            "label": "My Bag",
            "href": "/bag"
          },
          {
            "label": "Cart",
            "href": "/cart"
          },
          {
            "label": "Checkout",
            "href": "/checkout"
          }
        ]
      }
    ]
  },
  {
    "sections": [
      {
        "title": "Legal",
        "links": [
          {
            "label": "Privacy Policy",
            "href": "/privacy"
          },
          {
            "label": "Terms of Use",
            "href": "/terms"
          },
          {
            "label": "Company Information",
            "href": "/company-information"
          }
        ]
      },
      {
        "title": "More from Gadzio",
        "links": [
          {
            "label": "Home",
            "href": "/"
          },
          {
            "label": "Android Store",
            "href": "/android"
          }
        ]
      }
    ]
  }
];

export const FOOTER_BOTTOM: {
  shopHtml: string;
  copyright: string;
  legalLinks: FooterLink[];
  localeLabel: string;
  localeHref: string;
} = {
  "shopHtml": "More ways to shop: browse <a href=\"/search\" data-analytics-title=\"search all products\">all Gadzio products</a>. <span class=\"nowrap\">Questions? <a href=\"/support\" data-analytics-title=\"gadzio support\">Gadzio Support</a> is here to help.</span>",
  "copyright": "Copyright © 2026 Gadzio. All rights reserved.",
  "legalLinks": [
    {
      "label": "Privacy Policy",
      "href": "/privacy"
    },
    {
      "label": "Terms of Use",
      "href": "/terms"
    },
    {
      "label": "Sales and Refunds",
      "href": "/return-refund"
    },
    {
      "label": "Company Information",
      "href": "/company-information"
    },
    {
      "label": "Contact Us",
      "href": "/support#contact"
    }
  ],
  "localeLabel": "India",
  "localeHref": "/"
};
