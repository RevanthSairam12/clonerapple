import type { OppoCommunityOverride } from './admin-overrides';

const DEFAULT_CARDS = [
  { title: 'Quick reply speech to text', subtitle: '#OPPOFindN2Flip' },
  { title: 'CAPTURE THE SM:)ING EARTH', subtitle: 'Winners of the #ShotonOPPO #SmilingEarth day contest' },
];

export function OppoCommunitySection({ content }: { content?: OppoCommunityOverride } = {}) {
  const heading = content?.heading ?? 'OPPO Community';
  const viewAllLabel = content?.viewAllLabel ?? 'View all';
  const tagline =
    content?.tagline ??
    'A home for all OPPO fans to experience content, inspiration, and our beautiful technology.';
  // Override array length wins — extra cards extend the two-card grid. An
  // uploaded image replaces the gradient placeholder; without one the card
  // keeps its original stylised placeholder.
  const cards = content?.cards?.length
    ? content.cards.map((card, i) => {
        const template = DEFAULT_CARDS[i % DEFAULT_CARDS.length];
        return {
          title: card.title ?? template.title,
          subtitle: card.subtitle ?? template.subtitle,
          image: card.image || '',
        };
      })
    : DEFAULT_CARDS.map((card) => ({ ...card, image: '' }));

  return (
    <section className="oppo-community">
      <div className="oppo-community-inner">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#1d1d1f' }}>{heading}</h2>
          <a href="#" style={{ fontSize: '14px', color: '#6e6e73', display: 'flex', alignItems: 'center', gap: '4px' }}>
            {viewAllLabel} <span>{'>'}</span>
          </a>
        </div>

        <p className="oppo-community-tagline">{tagline}</p>

        <div className="oppo-community-grid">
          {cards.map((card, i) => (
            <div key={`${card.title}-${i}`} className="oppo-community-card">
              {card.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={card.image}
                  alt={card.title}
                  style={{ width: '100%', display: 'block', objectFit: 'cover' }}
                />
              ) : (
                <div className={`oppo-community-placeholder oppo-community-placeholder-${(i % 2) + 1}`} />
              )}
              <div className="oppo-community-card-label">
                <strong>{card.title}</strong>
                <small>{card.subtitle}</small>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
