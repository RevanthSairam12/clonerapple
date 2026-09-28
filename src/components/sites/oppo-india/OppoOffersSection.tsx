import type { OppoOfferOverride } from './admin-overrides';

interface OfferCard {
  title: string;
  description: string;
  image: string;
  href?: string;
}

const OFFERS: OfferCard[] = [
  {
    title: 'Exchange Program',
    description: 'Upgrade Now and Save Up to ₹43,900',
    image: '/sites/oppo-india/images/offer_exchange.png',
    href: '#',
  },
  {
    title: 'Welcome Gift',
    description: 'Limited-time offer for all new members.',
    image: '/sites/oppo-india/images/offer_gift.png',
    href: '#',
  },
  {
    title: 'Student Offer',
    description: 'Students Get up to 44% OFF on\nSmartphone',
    image: '/sites/oppo-india/images/offer_student.png',
    href: '#',
  },
];

export function OppoOffersSection({
  heading = 'Offers made for you',
  items: overrides,
}: {
  heading?: string;
  items?: OppoOfferOverride[];
} = {}) {
  // Override array length wins — an added card clones the last one.
  const offers = overrides
    ? overrides.map((o, i) => {
        const offer = OFFERS[i] ?? OFFERS[OFFERS.length - 1];
        return {
          ...offer,
          title: o.title ?? offer.title,
          description: o.description ?? offer.description,
          image: o.image ?? offer.image,
          href: o.href ?? offer.href,
        };
      })
    : OFFERS;

  return (
    <section className="oppo-offers-section">
      <div className="oppo-offers-container">
        <h2 className="oppo-offers-title">{heading}</h2>

        <div className="oppo-offers-grid">
          {offers.map((offer) => (
            <a key={offer.title} href={offer.href || '#'} className="oppo-offer-card">
              <div className="oppo-offer-card-image">
                <img
                  src={offer.image}
                  alt={offer.title}
                  loading="lazy"
                />
              </div>
              <div className="oppo-offer-card-body">
                <h3 className="oppo-offer-card-title">{offer.title}</h3>
                <div className="oppo-offer-card-footer">
                  <p className="oppo-offer-card-desc">{offer.description}</p>
                  <span className="oppo-offer-card-arrow" aria-hidden="true">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="4" y1="12" x2="20" y2="12" />
                      <polyline points="14 6 20 12 14 18" />
                    </svg>
                  </span>
                </div>
              </div>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
