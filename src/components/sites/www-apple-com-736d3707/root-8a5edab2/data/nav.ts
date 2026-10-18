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
          { label: "Explore All Adapters", href: "/in/shop/iphone/accessories/power-adapter-cable", elevated: true },
          { label: "20W USB-C Power Adapter", href: "/shop/product/pa-gadzio-20w-usbc", elevated: true },
          { label: "35W Dual USB-C Port Compact Adapter", href: "/shop/product/pa-gadzio-35w-duo", elevated: true },
          { label: "Fast GaN Charging", href: "/in/shop/iphone/accessories/power-adapter-cable", elevated: true }
        ]
      },
      {
        heading: "Shop by Category",
        region: "shop adapters",
        elevatedGroup: false,
        links: [
          { label: "Fast Charging Adapters", href: "/in/shop/iphone/accessories/power-adapter-cable", elevated: false },
          { label: "Cable & Plug Organizers", href: "/in/shop/iphone/accessories/cable-plug-case", elevated: false },
          { label: "Phone Cases & Protection", href: "/in/shop/iphone/accessories/cases-protection", elevated: false }
        ]
      },
      {
        heading: "Quick Links",
        region: "quick links adapters",
        elevatedGroup: false,
        links: [
          { label: "Shopping Bag", href: "/cart", elevated: false },
          { label: "Order Help", href: "/support", elevated: false },
          { label: "All Collections", href: "/in/shop/iphone/accessories/cases-protection", elevated: false }
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
          { label: "Explore All Cable Cases", href: "/in/shop/iphone/accessories/cable-plug-case", elevated: true },
          { label: "Gadzio Silicone Cable Organizer", href: "/shop/product/cpc-gadzio-silicone-organizer", elevated: true },
          { label: "Gadzio Hard Shell Charger Case", href: "/shop/product/cpc-gadzio-hard-shell-charger", elevated: true }
        ]
      },
      {
        heading: "Related Categories",
        region: "shop cables",
        elevatedGroup: false,
        links: [
          { label: "Power Adapters & Charging", href: "/in/shop/iphone/accessories/power-adapter-cable", elevated: false },
          { label: "Wired Audio Earphones", href: "/in/shop/iphone/accessories/wired-earphones", elevated: false },
          { label: "AirPods Cases", href: "/in/shop/iphone/accessories/airpods-case", elevated: false }
        ]
      },
      {
        heading: "Quick Links",
        region: "quick links cables",
        elevatedGroup: false,
        links: [
          { label: "Shopping Bag", href: "/cart", elevated: false },
          { label: "Fast Charging Adapters", href: "/in/shop/iphone/accessories/power-adapter-cable", elevated: false },
          { label: "Phone Cases & Protection", href: "/in/shop/iphone/accessories/cases-protection", elevated: false }
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
          { label: "Explore All Earphones", href: "/in/shop/iphone/accessories/wired-earphones", elevated: true },
          { label: "Gadzio Pulse USB-C Earphones", href: "/shop/product/we-gadzio-pulse-usbc", elevated: true },
          { label: "Gadzio Acoustic 3.5mm Earphones", href: "/shop/product/we-gadzio-acoustic-35mm", elevated: true }
        ]
      },
      {
        heading: "AirPods Protection",
        region: "audio categories",
        elevatedGroup: false,
        links: [
          { label: "Explore AirPods Cases", href: "/in/shop/iphone/accessories/airpods-case", elevated: false },
          { label: "Silicone Case for AirPods Pro 3", href: "/shop/product/ac-gadzio-silicone-pro3", elevated: false },
          { label: "Crystal Clear Case for AirPods Pro 2", href: "/shop/product/ac-gadzio-clear-pro2", elevated: false }
        ]
      },
      {
        heading: "Quick Links",
        region: "quick links earphones",
        elevatedGroup: false,
        links: [
          { label: "Shopping Bag", href: "/cart", elevated: false },
          { label: "Power & Cables", href: "/in/shop/iphone/accessories/power-adapter-cable", elevated: false }
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
          { label: "Gadzio CrystalArmor Clear Case (MagSafe)", href: "/shop/product/iphone18pro-max-clear-magsafe", elevated: true },
          { label: "Gadzio MagPulse Liquid Silicone Case", href: "/shop/product/iphone17-silicone-black", elevated: true }
        ]
      },
      {
        heading: "Mobile Cases Catalog",
        region: "cases by device",
        elevatedGroup: false,
        links: [
          { label: "Explore Mobile Cases", href: "/in/shop/iphone/accessories/mobile-cases", elevated: false },
          { label: "Silicone Case for iPhone 17 Pro Max", href: "/shop/product/mc-gadzio-silicone-17promax", elevated: false },
          { label: "Crystal Clear Case for iPhone 17 Pro", href: "/shop/product/mc-gadzio-clear-17pro", elevated: false }
        ]
      },
      {
        heading: "Featured",
        region: "cases features",
        elevatedGroup: false,
        links: [
          { label: "Military-Grade Drop Defense", href: "/in/shop/iphone/accessories/cases-protection", elevated: false },
          { label: "1-Year Warranty Protection", href: "/terms", elevated: false },
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
          { label: "Order Help", href: "/support", elevated: false }
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
          { label: "Order Help", href: "/support#order-help", elevated: true },
          { label: "Warranty & Guarantee", href: "/terms", elevated: true },
          { label: "Shipping & Delivery Policy", href: "/terms", elevated: true },
          { label: "Privacy & Account Help", href: "/privacy", elevated: true }
        ]
      },
      {
        heading: "Helpful Topics",
        region: "helpful topics",
        elevatedGroup: false,
        links: [
          { label: "1-Year Replacement Warranty", href: "/terms", elevated: false },
          { label: "Returns & Exchanges", href: "/terms", elevated: false },
          { label: "Payment & PayU Inquiries", href: "/terms", elevated: false },
          { label: "Manage Your Account", href: "/auth", elevated: false }
        ]
      },
      {
        heading: "Quick Links",
        region: "quick links support",
        elevatedGroup: false,
        links: [
          { label: "Shopping Bag", href: "/cart", elevated: false },
          { label: "Cases & Protection", href: "/in/shop/iphone/accessories/cases-protection", elevated: false },
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
