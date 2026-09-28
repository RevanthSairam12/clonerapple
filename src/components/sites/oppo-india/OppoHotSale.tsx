import type { OppoHotSaleOverride } from './admin-overrides';

export function OppoHotSale({ content }: { content?: OppoHotSaleOverride } = {}) {
  const badge = content?.badge ?? 'OPPO AI Phone';
  const title = content?.title ?? 'OPPO Find X9s';
  const tagline = content?.tagline ?? 'Your Story Matters.\nCreate with Find.';
  const image = content?.image ?? '/sites/oppo-india/images/find_x9s.jpg';
  const learnLabel = content?.learnLabel ?? 'Learn more';
  const buyLabel = content?.buyLabel ?? 'Buy now';

  return (
    <section>
      <div className="oppo-section-header">
        <h2 className="oppo-section-title">Hot Sale</h2>
        <button type="button" className="oppo-section-arrow" aria-label="View more">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      <div className="oppo-hot-sale">
        <div className="oppo-hot-sale-card">
          <div className="oppo-hot-sale-info">
            <span className="oppo-hero-badge">{badge}</span>
            <h3 style={{ fontSize: '32px', fontWeight: 700, marginTop: '12px', color: '#1d1d1f' }}>
              {title}
            </h3>
            <div className="oppo-hot-sale-tagline">
              {tagline.split('\n').map((line, i, arr) => (
                <span key={i}>
                  {line}
                  {i < arr.length - 1 && <br />}
                </span>
              ))}
            </div>
            <div className="oppo-hot-sale-links">
              <a href="#">{learnLabel}</a>
              <a href="#">{buyLabel}</a>
            </div>
          </div>
          <div className="oppo-hot-sale-image">
            <img
              src={image}
              alt={title}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
