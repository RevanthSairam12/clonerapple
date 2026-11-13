export interface NavWordmark {
  viewBox: string;
  width: number;
  height: number;
  paths: string[];
}

export interface NavItem {
  key: string;
  label: string;
  href: string;
  ariaLabel: string;
  wordmark: NavWordmark;
}

export interface FlyoutLink {
  label: string;
  href: string;
  ariaLabel?: string;
  elevated: boolean;
}

export interface FlyoutGroup {
  heading: string;
  region: string;
  elevatedGroup: boolean;
  links: FlyoutLink[];
}

export interface FlyoutMenu {
  key: string;
  heightPx: number;
  groups: FlyoutGroup[];
}

export interface SearchPanel {
  placeholder: string;
  heightPx: number;
  quickLinksHeading: string;
  quickLinks: { label: string; href: string }[];
}

export const DEFAULT_HEADER_PROMO = {
  text: 'Explore Gadzio Cases, Chargers & Accessories — Shipping across India',
  href: '/in/shop/iphone/accessories/cases-protection',
};

export const DEFAULT_SECONDARY_LINKS: { label: string; href: string; ariaLabel?: string }[] = [
  { label: 'Cases & Protection', href: '/in/shop/iphone/accessories/cases-protection' },
  { label: 'Mobile Cases', href: '/in/shop/iphone/accessories/mobile-cases' },
  { label: 'Power Adapters & Cables', href: '/in/shop/iphone/accessories/power-adapter-cable' },
  { label: 'Wired Earphones', href: '/in/shop/iphone/accessories/wired-earphones' },
  { label: 'Shipping Policy', href: '/shipping-policy' },
  { label: 'Return & Refund Policy', href: '/return-refund' },
  { label: 'Support', href: '/support' },
];

export const NAV_ITEMS: NavItem[] = [
  {
    key: "adapters",
    label: "Adapters",
    href: "/in/shop/iphone/accessories/power-adapter-cable",
    ariaLabel: "Adapters",
    wordmark: {
      viewBox: "0 0 1 1",
      width: 1,
      height: 1,
      paths: []
    }
  },
  {
    key: "cables",
    label: "Cables & Plugs",
    href: "/in/shop/iphone/accessories/cable-plug-case",
    ariaLabel: "Cables and Plugs",
    wordmark: {
      viewBox: "0 0 1 1",
      width: 1,
      height: 1,
      paths: []
    }
  },
  {
    key: "earphones",
    label: "Earphones",
    href: "/in/shop/iphone/accessories/wired-earphones",
    ariaLabel: "Earphones",
    wordmark: {
      viewBox: "0 0 1 1",
      width: 1,
      height: 1,
      paths: []
    }
  },
  {
    key: "cases",
    label: "Cases & Protection",
    href: "/in/shop/iphone/accessories/cases-protection",
    ariaLabel: "Cases & Protection",
    wordmark: {
      viewBox: "0 0 1 1",
      width: 1,
      height: 1,
      paths: []
    }
  },
  {
    key: "accessories",
    label: "Mobile Cases",
    href: "/in/shop/iphone/accessories/mobile-cases",
    ariaLabel: "Mobile Cases",
    wordmark: {
      viewBox: "0 0 1 1",
      width: 1,
      height: 1,
      paths: []
    }
  },
  {
    key: "support",
    label: "Support",
    href: "/support",
    ariaLabel: "Support",
    wordmark: {
      viewBox: "0 0 1 1",
      width: 1,
      height: 1,
      paths: []
    }
  }
];

export const NAV_MENUS: FlyoutMenu[] = [
  {
    key: "adapters",
    heightPx: 380,
    groups: [
      {
        heading: "Explore Adapters",
        region: "explore adapters",
        elevatedGroup: true,
        links: [
          { label: "All Power Adapters & Cables", href: "/in/shop/iphone/accessories/power-adapter-cable", elevated: true },
          { label: "Cable & Plug Organizers", href: "/in/shop/iphone/accessories/cable-plug-case", elevated: true },
          { label: "Search Adapters", href: "/search?q=adapter", elevated: true },
          { label: "Sale & Offers", href: "/sale", elevated: true }
        ]
      },
      {
        heading: "Shop by Category",
        region: "shop adapters",
        elevatedGroup: false,
        links: [
          { label: "Cases & Protection", href: "/in/shop/iphone/accessories/cases-protection", elevated: false },
          { label: "Mobile Cases", href: "/in/shop/iphone/accessories/mobile-cases", elevated: false },
          { label: "Wired Earphones", href: "/in/shop/iphone/accessories/wired-earphones", elevated: false },
          { label: "AirPods Cases", href: "/in/shop/iphone/accessories/airpods-case", elevated: false }
        ]
      },
      {
        heading: "Quick Links",
        region: "quick links adapters",
        elevatedGroup: false,
        links: [
          { label: "Shopping Bag", href: "/cart", elevated: false },
          { label: "Shipping Policy", href: "/shipping-policy", elevated: false },
          { label: "Gadzio Support", href: "/support", elevated: false }
        ]
      }
    ]
  },
  {
    key: "cables",
    heightPx: 380,
    groups: [
      {
        heading: "Explore Cable & Plug Cases",
        region: "explore cables",
        elevatedGroup: true,
        links: [
          { label: "Explore All Cable & Plug Cases", href: "/in/shop/iphone/accessories/cable-plug-case", elevated: true },
          { label: "Power Adapters & Cables", href: "/in/shop/iphone/accessories/power-adapter-cable", elevated: true },
          { label: "Search Cables", href: "/search?q=cable", elevated: true }
        ]
      },
      {
        heading: "Related Categories",
        region: "shop cables",
        elevatedGroup: false,
        links: [
          { label: "Wired Earphones", href: "/in/shop/iphone/accessories/wired-earphones", elevated: false },
          { label: "AirPods Cases", href: "/in/shop/iphone/accessories/airpods-case", elevated: false },
          { label: "Cases & Protection", href: "/in/shop/iphone/accessories/cases-protection", elevated: false }
        ]
      },
      {
        heading: "Quick Links",
        region: "quick links cables",
        elevatedGroup: false,
        links: [
          { label: "Shopping Bag", href: "/cart", elevated: false },
          { label: "Shipping Policy", href: "/shipping-policy", elevated: false },
          { label: "Gadzio Support", href: "/support", elevated: false }
        ]
      }
    ]
  },
  {
    key: "earphones",
    heightPx: 380,
    groups: [
      {
        heading: "Explore Earphones & Audio",
        region: "explore earphones",
        elevatedGroup: true,
        links: [
          { label: "Explore All Wired Earphones", href: "/in/shop/iphone/accessories/wired-earphones", elevated: true },
          { label: "Explore AirPods Cases", href: "/in/shop/iphone/accessories/airpods-case", elevated: true },
          { label: "Search Audio", href: "/search?q=earphones", elevated: true }
        ]
      },
      {
        heading: "Related Categories",
        region: "audio categories",
        elevatedGroup: false,
        links: [
          { label: "Power Adapters & Cables", href: "/in/shop/iphone/accessories/power-adapter-cable", elevated: false },
          { label: "Cable & Plug Cases", href: "/in/shop/iphone/accessories/cable-plug-case", elevated: false }
        ]
      },
      {
        heading: "Quick Links",
        region: "quick links earphones",
        elevatedGroup: false,
        links: [
          { label: "Shopping Bag", href: "/cart", elevated: false },
          { label: "Return & Refund Policy", href: "/return-refund", elevated: false },
          { label: "Gadzio Support", href: "/support", elevated: false }
        ]
      }
    ]
  },
  {
    key: "cases",
    heightPx: 380,
    groups: [
      {
        heading: "Explore Cases & Protection",
        region: "explore cases",
        elevatedGroup: true,
        links: [
          { label: "Explore All Cases", href: "/in/shop/iphone/accessories/cases-protection", elevated: true },
          { label: "Explore Mobile Cases", href: "/in/shop/iphone/accessories/mobile-cases", elevated: true },
          { label: "Explore AirPods Cases", href: "/in/shop/iphone/accessories/airpods-case", elevated: true },
          { label: "Search Cases", href: "/search?q=case", elevated: true }
        ]
      },
      {
        heading: "More Storefront",
        region: "cases by device",
        elevatedGroup: false,
        links: [
          { label: "Android Store", href: "/android", elevated: false },
          { label: "Sale & Offers", href: "/sale", elevated: false },
          { label: "Search Full Catalog", href: "/search", elevated: false }
        ]
      },
      {
        heading: "Policies & Help",
        region: "cases features",
        elevatedGroup: false,
        links: [
          { label: "Shipping Policy", href: "/shipping-policy", elevated: false },
          { label: "Return & Refund Policy", href: "/return-refund", elevated: false },
          { label: "Warranty Policy", href: "/terms#warranty", elevated: false },
          { label: "Shopping Bag", href: "/cart", elevated: false }
        ]
      }
    ]
  },
  {
    key: "accessories",
    heightPx: 380,
    groups: [
      {
        heading: "Explore All Collections",
        region: "explore accessories",
        elevatedGroup: true,
        links: [
          { label: "Cases & Protection", href: "/in/shop/iphone/accessories/cases-protection", elevated: true },
          { label: "Mobile Cases", href: "/in/shop/iphone/accessories/mobile-cases", elevated: true },
          { label: "Power Adapters & Cables", href: "/in/shop/iphone/accessories/power-adapter-cable", elevated: true },
          { label: "Wired Earphones", href: "/in/shop/iphone/accessories/wired-earphones", elevated: true },
          { label: "Cable & Plug Cases", href: "/in/shop/iphone/accessories/cable-plug-case", elevated: true },
          { label: "AirPods Cases", href: "/in/shop/iphone/accessories/airpods-case", elevated: true }
        ]
      },
      {
        heading: "More Essentials",
        region: "more accessories",
        elevatedGroup: false,
        links: [
          { label: "Search Full Catalog", href: "/search", elevated: false },
          { label: "Shopping Bag", href: "/bag", elevated: false },
          { label: "Android Store", href: "/android", elevated: false }
        ]
      },
      {
        heading: "Quick Links",
        region: "quick links accessories",
        elevatedGroup: false,
        links: [
          { label: "Shopping Bag", href: "/cart", elevated: false },
          { label: "Shipping Policy", href: "/shipping-policy", elevated: false },
          { label: "Gadzio Support", href: "/support", elevated: false }
        ]
      }
    ]
  },
  {
    key: "support",
    heightPx: 380,
    groups: [
      {
        heading: "Explore Support",
        region: "explore support",
        elevatedGroup: true,
        links: [
          { label: "Gadzio Support", href: "/support", elevated: true },
          { label: "Shipping Policy", href: "/shipping-policy", elevated: true },
          { label: "Return & Refund Policy", href: "/return-refund", elevated: true },
          { label: "Warranty Policy", href: "/terms#warranty", elevated: true },
          { label: "Company Information", href: "/company-information", elevated: true }
        ]
      },
      {
        heading: "Helpful Topics",
        region: "helpful topics",
        elevatedGroup: false,
        links: [
          { label: "Order Help", href: "/support#order-help", elevated: false },
          { label: "Payment Help", href: "/support#payments", elevated: false },
          { label: "Privacy Policy", href: "/privacy", elevated: false },
          { label: "Terms & Conditions", href: "/terms", elevated: false }
        ]
      },
      {
        heading: "Quick Links",
        region: "quick links support",
        elevatedGroup: false,
        links: [
          { label: "Your Account", href: "/account", elevated: false },
          { label: "Shopping Bag", href: "/cart", elevated: false },
          { label: "Contact Gadzio", href: "/support#contact", elevated: false }
        ]
      }
    ]
  }
];

export const SEARCH_PANEL: SearchPanel = {
  placeholder: "Search cases, adapters, cables, earphones...",
  heightPx: 388,
  quickLinksHeading: "Quick Collections",
  quickLinks: [
    { label: "Cases & Protection", href: "/in/shop/iphone/accessories/cases-protection" },
    { label: "Mobile Cases", href: "/in/shop/iphone/accessories/mobile-cases" },
    { label: "Power Adapters & Cables", href: "/in/shop/iphone/accessories/power-adapter-cable" },
    { label: "Wired Earphones", href: "/in/shop/iphone/accessories/wired-earphones" },
    { label: "Cable & Plug Cases", href: "/in/shop/iphone/accessories/cable-plug-case" },
    { label: "AirPods Cases", href: "/in/shop/iphone/accessories/airpods-case" }
  ]
};
