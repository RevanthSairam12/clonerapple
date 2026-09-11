export function OppoHotSale() {
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
            <span className="oppo-hero-badge">OPPO AI Phone</span>
            <h3 style={{ fontSize: '32px', fontWeight: 700, marginTop: '12px', color: '#1d1d1f' }}>
              OPPO Find X9s
            </h3>
            <div className="oppo-hot-sale-tagline">
              Your Story Matters.<br />
              Create with Find.
            </div>
            <div className="oppo-hot-sale-links">
              <a href="#">Learn more</a>
              <a href="#">Buy now</a>
            </div>
          </div>
          <div className="oppo-hot-sale-image">
            <img
              src="/sites/oppo-india/images/find_x9s.jpg"
              alt="OPPO Find X9s in three colors"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
