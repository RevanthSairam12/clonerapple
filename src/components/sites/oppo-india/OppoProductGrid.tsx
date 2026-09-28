import type { OppoProductOverride } from './admin-overrides';

interface ProductCard {
  title: string;
  titleSup?: string;
  image?: string;
  placeholderClass?: string;
  descriptions: string[];
  learnHref: string;
  buyHref: string;
}

const PRODUCTS: ProductCard[] = [
  {
    title: 'Charging Adapters',
    titleSup: '',
    image: '/sites/oppo-india/images/chargingadpters.png',
    descriptions: ['Browse our full collection of adapters'],
    learnHref: '#',
    buyHref: '#',
  },
  {
    title: 'OPPO F33',
    titleSup: '5G',
    image: '/sites/oppo-india/images/f33.jpg',
    descriptions: ['Wide for Big Moments'],
    learnHref: '#',
    buyHref: '#',
  },
  {
    title: 'OPPO Bubble',
    image: '/sites/oppo-india/images/oppo_bubble.jpg',
    descriptions: ['Ultra-Clear Rear Selfie View', 'Custom Vibe E-Badge'],
    learnHref: '#',
    buyHref: '#',
  },
  {
    title: 'OPPO Enco Air5',
    placeholderClass: 'oppo-product-placeholder-earbuds',
    descriptions: ['True Wireless', 'Noise Cancelling Earbuds'],
    learnHref: '#',
    buyHref: '#',
  },
  {
    title: 'OPPO Enco Air5 Pro',
    placeholderClass: 'oppo-product-placeholder-earbuds',
    descriptions: ['True Wireless Noise Cancelling Earbuds'],
    learnHref: '#',
    buyHref: '#',
  },
  {
    title: 'OPPO Enco Buds3 Pro+',
    placeholderClass: 'oppo-product-placeholder-earbuds oppo-product-placeholder-navy',
    descriptions: ['True Wireless Noise Cancelling Earbuds', 'Non-Stop Grooves', 'Unmatched Battery Life'],
    learnHref: '#',
    buyHref: '#',
  },
  {
    title: 'OPPO Magnetic Charger 2 AIRVOOC 50W',
    placeholderClass: 'oppo-product-placeholder-charger',
    descriptions: ['Fast Wireless Charging'],
    learnHref: '#',
    buyHref: '#',
  },
  {
    title: 'OPPO Magnetic Cooling Card',
    placeholderClass: 'oppo-product-placeholder-charger',
    descriptions: ['Keep Your Phone Cool'],
    learnHref: '#',
    buyHref: '#',
  },
];

export function OppoProductGrid({ items: overrides }: { items?: OppoProductOverride[] } = {}) {
  // Override array length wins — an added card clones the last one (its
  // placeholder styling carries over; the editor sets title/description).
  const products = overrides
    ? overrides.map((o, i) => {
        const product = PRODUCTS[i] ?? PRODUCTS[PRODUCTS.length - 1];
        // The admin editor edits descriptions as a newline-separated textarea.
        const descs = o.descriptions;
        return {
          ...product,
          title: o.title ?? product.title,
          titleSup: o.titleSup ?? product.titleSup,
          image: o.image ?? product.image,
          descriptions: Array.isArray(descs)
            ? descs
            : typeof descs === 'string' && descs.length > 0
              ? descs.split('\n').map((d) => d.trim()).filter(Boolean)
              : product.descriptions,
          learnHref: o.learnHref ?? product.learnHref,
          buyHref: o.buyHref ?? product.buyHref,
        };
      })
    : PRODUCTS;

  return (
    <section style={{ paddingBottom: '2px' }}>
      <div className="oppo-product-grid">
        {products.map((product) => (
          <div key={product.title} className="oppo-product-card">
            <h3 className="oppo-product-card-title">
              {product.title}
              {product.titleSup && <sup> {product.titleSup}</sup>}
            </h3>
            <div className="oppo-product-card-image">
              {product.image ? (
                <img src={product.image} alt={product.title} />
              ) : (
                <div className={`oppo-product-placeholder ${product.placeholderClass || ''}`} />
              )}
            </div>
            <div className="oppo-product-card-footer">
              <div className="oppo-product-card-desc">
                {product.descriptions.map((desc, i) => (
                  <span key={i}>
                    {desc}
                    {i < product.descriptions.length - 1 && <br />}
                  </span>
                ))}
              </div>
              <div className="oppo-product-card-links">
                <a href={product.learnHref}>Learn more</a>
                <a href={product.buyHref}>Buy now</a>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
