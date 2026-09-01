F// Content data for Apple Education Store India clone
// Source: https://www.apple.com/in-edu/store

export const HERO = {
  badge: 'Education Store',
  headline: 'The best way to buy the products you love.',
  subhead: 'Education pricing helps students, teachers, and parents get more for less.',
  promo: {
    headline: 'Back to School.',
    offer: 'For a limited time, get AirPods\u00a04 with Mac and Apple Pencil Pro with iPad when you buy with education savings.',
    disclaimer: 'Offer ends 24\u00a0September\u00a02026.',
  },
};

export const BTS_OFFERS = [
  {
    id: 'mac-offer',
    theme: 'dark' as const,
    kicker: 'Back to School',
    headline: 'Mac.',
    offer: 'Get AirPods\u00a04 with Mac, with education savings.',
    upgradeNote: 'Or upgrade to AirPods\u00a04 with Active Noise Cancellation or AirPods\u00a0Pro\u00a03 for an additional cost.',
    image: 'https://store.storeimages.cdn-apple.com/4668/as-images.apple.com/is/bts26-mac-airpods4-hero?wid=1200&hei=750&fmt=jpeg&qlt=90',
    imageFallbackGradient: 'linear-gradient(135deg, #1d1d1f 0%, #2d2d2f 60%, #1a1a2e 100%)',
    ctaPrimary: { label: 'Shop Mac', href: 'https://www.apple.com/in-edu/shop/buy-mac' },
    ctaSecondary: { label: 'Learn more', href: 'https://www.apple.com/in-edu/shop/back-to-school' },
  },
  {
    id: 'ipad-offer',
    theme: 'light' as const,
    kicker: 'Back to School',
    headline: 'iPad.',
    offer: 'Get Apple Pencil Pro with iPad, with education savings.',
    upgradeNote: 'Or upgrade to Apple Pencil Pro with USB‑C for an additional cost.',
    image: 'https://store.storeimages.cdn-apple.com/4668/as-images.apple.com/is/bts26-ipad-pencil-hero?wid=1200&hei=750&fmt=jpeg&qlt=90',
    imageFallbackGradient: 'linear-gradient(135deg, #f0f0f5 0%, #e8e8f0 60%, #dde8f0 100%)',
    ctaPrimary: { label: 'Shop iPad', href: 'https://www.apple.com/in-edu/shop/buy-ipad' },
    ctaSecondary: { label: 'Learn more', href: 'https://www.apple.com/in-edu/shop/back-to-school' },
  },
];

export const MAC_PRODUCTS = [
  {
    id: 'mba-13-m4',
    name: 'MacBook Air',
    descriptor: '13\u2011inch',
    chip: 'Apple\u00a0M4',
    price: '₹89,900.00',
    priceNote: 'Starting price for education',
    image: 'https://store.storeimages.cdn-apple.com/4668/as-images.apple.com/is/mba-13-m4-skyblue-select-202503?wid=800&hei=800&fmt=jpeg&qlt=90&.v=1741717450224',
    buyHref: 'https://www.apple.com/in-edu/shop/buy-mac/macbook-air/13-inch',
    learnHref: 'https://www.apple.com/in/macbook-air/',
  },
  {
    id: 'mba-15-m4',
    name: 'MacBook Air',
    descriptor: '15\u2011inch',
    chip: 'Apple\u00a0M4',
    price: '₹1,09,900.00',
    priceNote: 'Starting price for education',
    image: 'https://store.storeimages.cdn-apple.com/4668/as-images.apple.com/is/mba-15-m4-skyblue-select-202503?wid=800&hei=800&fmt=jpeg&qlt=90&.v=1741717450224',
    buyHref: 'https://www.apple.com/in-edu/shop/buy-mac/macbook-air/15-inch',
    learnHref: 'https://www.apple.com/in/macbook-air/',
  },
  {
    id: 'mbp-14-m4',
    name: 'MacBook Pro',
    descriptor: '14\u2011inch',
    chip: 'Apple\u00a0M4',
    price: '₹1,39,900.00',
    priceNote: 'Starting price for education',
    image: 'https://store.storeimages.cdn-apple.com/4668/as-images.apple.com/is/mbp-14-m4-spacegray-select-202411?wid=800&hei=800&fmt=jpeg&qlt=90&.v=1730489271229',
    buyHref: 'https://www.apple.com/in-edu/shop/buy-mac/macbook-pro/14-inch',
    learnHref: 'https://www.apple.com/in/macbook-pro/',
  },
];

export const IPAD_PRODUCTS = [
  {
    id: 'ipad-pro-11',
    name: 'iPad Pro',
    descriptor: '11\u2011inch',
    chip: 'Apple\u00a0M4',
    price: '₹99,900.00',
    priceNote: 'Starting price for education',
    image: 'https://store.storeimages.cdn-apple.com/4668/as-images.apple.com/is/ipad-pro-11-select-cell-spacegray-202405_FV1_FMT_WHH?wid=800&hei=800&fmt=jpeg&qlt=90&.v=1713920820697',
    buyHref: 'https://www.apple.com/in-edu/shop/buy-ipad/ipad-pro',
    learnHref: 'https://www.apple.com/in/ipad-pro/',
  },
  {
    id: 'ipad-pro-13',
    name: 'iPad Pro',
    descriptor: '13\u2011inch',
    chip: 'Apple\u00a0M4',
    price: '₹1,29,900.00',
    priceNote: 'Starting price for education',
    image: 'https://store.storeimages.cdn-apple.com/4668/as-images.apple.com/is/ipad-pro-13-select-cell-spacegray-202405_FV1_FMT_WHH?wid=800&hei=800&fmt=jpeg&qlt=90&.v=1713920820697',
    buyHref: 'https://www.apple.com/in-edu/shop/buy-ipad/ipad-pro',
    learnHref: 'https://www.apple.com/in/ipad-pro/',
  },
  {
    id: 'ipad-air-11',
    name: 'iPad Air',
    descriptor: '11\u2011inch',
    chip: 'Apple\u00a0M3',
    price: '₹59,900.00',
    priceNote: 'Starting price for education',
    image: 'https://store.storeimages.cdn-apple.com/4668/as-images.apple.com/is/ipad-air-11-select-cell-blue-202405_FV1_FMT_WHH?wid=800&hei=800&fmt=jpeg&qlt=90&.v=1713920820697',
    buyHref: 'https://www.apple.com/in-edu/shop/buy-ipad/ipad-air',
    learnHref: 'https://www.apple.com/in/ipad-air/',
  },
  {
    id: 'ipad-10',
    name: 'iPad',
    descriptor: '10th\u00a0generation',
    chip: 'Apple\u00a0A14\u00a0Bionic',
    price: '₹35,900.00',
    priceNote: 'Starting price for education',
    image: 'https://store.storeimages.cdn-apple.com/4668/as-images.apple.com/is/ipad-10th-wifi-blue-select-202212?wid=800&hei=800&fmt=jpeg&qlt=90&.v=1670854834130',
    buyHref: 'https://www.apple.com/in-edu/shop/buy-ipad/ipad',
    learnHref: 'https://www.apple.com/in/ipad/',
  },
];

export const EDU_IN_ACTION = [
  {
    id: 'visual-arts',
    field: 'Visual Arts',
    device: 'Mac',
    headline: 'Turning imagination into impact.',
    body: 'Students in Visual Arts programs use Mac with apps like Procreate and Adobe Creative Cloud to create, animate, and share stunning work.',
    app: 'Procreate Dreams',
    bgColor: '#1c1c1e',
    accentColor: '#e8764a',
  },
  {
    id: 'applied-ai',
    field: 'Applied AI',
    device: 'Mac',
    headline: 'Training models, building futures.',
    body: 'Computer Science students use MacBook Pro with Xcode and Python to develop machine learning models and AI-powered apps.',
    app: 'Xcode',
    bgColor: '#2c1c3e',
    accentColor: '#bf5af2',
  },
  {
    id: 'industrial-engineering',
    field: 'Industrial Engineering',
    device: 'iPad',
    headline: 'Designing the world in 3D.',
    body: 'Engineering students use iPad Pro with Apple Pencil and Shapr3D to sketch, model, and iterate on complex mechanical designs.',
    app: 'Shapr3D',
    bgColor: '#1c2c1e',
    accentColor: '#30d158',
  },
  {
    id: 'chemistry',
    field: 'Chemistry',
    device: 'iPad',
    headline: 'Notes that react as fast as you think.',
    body: 'Science students use iPad Air with Apple Pencil Pro and Goodnotes to annotate, diagram, and organise lab notes in real time.',
    app: 'Goodnotes',
    bgColor: '#1c2a3e',
    accentColor: '#0a84ff',
  },
];

export const HOW_TO_BUY_STEPS = [
  {
    step: '01',
    headline: 'Check your eligibility.',
    body: 'Students, parents of students, teachers, and staff at qualifying educational institutions are eligible for Apple Education Pricing.',
    link: { label: 'Verify eligibility', href: 'https://www.apple.com/in-edu/store' },
  },
  {
    step: '02',
    headline: 'Choose your products.',
    body: 'Select from Mac, iPad, and accessories that qualify for education savings. Add them to your bag on the Apple Education Store.',
    link: { label: 'See all products', href: 'https://www.apple.com/in-edu/store' },
  },
  {
    step: '03',
    headline: 'Get verified and save.',
    body: 'Verify your student or educator status via UNiDAYS, or bring your institution ID to an Apple Store. Savings are applied automatically.',
    link: { label: 'Learn about UNiDAYS', href: 'https://www.unidays.com/' },
  },
];

export const SHOP_CATEGORIES = [
  { label: 'Mac', icon: '💻', href: 'https://www.apple.com/in-edu/shop/buy-mac' },
  { label: 'iPad', icon: '📱', href: 'https://www.apple.com/in-edu/shop/buy-ipad' },
  { label: 'iPhone', icon: '📲', href: 'https://www.apple.com/in-edu/shop/buy-iphone' },
  { label: 'Apple\u00a0Watch', icon: '⌚', href: 'https://www.apple.com/in-edu/shop/buy-watch' },
  { label: 'AirPods', icon: '🎧', href: 'https://www.apple.com/in-edu/shop/accessories/all/airpods' },
  { label: 'AppleCare+', icon: '🛡️', href: 'https://www.apple.com/in-edu/shop/browse/home/shop_applecare' },
  { label: 'Accessories', icon: '🔌', href: 'https://www.apple.com/in-edu/shop/accessories/all' },
  { label: 'Refurbished', icon: '♻️', href: 'https://www.apple.com/in-edu/shop/refurbished' },
];
