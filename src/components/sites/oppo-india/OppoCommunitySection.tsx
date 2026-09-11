export function OppoCommunitySection() {
  return (
    <section className="oppo-community">
      <div className="oppo-community-inner">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#1d1d1f' }}>OPPO Community</h2>
          <a href="#" style={{ fontSize: '14px', color: '#6e6e73', display: 'flex', alignItems: 'center', gap: '4px' }}>
            View all <span>{'>'}</span>
          </a>
        </div>

        <p className="oppo-community-tagline">
          A home for all OPPO fans to experience content, inspiration, and our beautiful technology.
        </p>

        <div className="oppo-community-grid">
          <div className="oppo-community-card">
            <div className="oppo-community-placeholder oppo-community-placeholder-1" />
            <div className="oppo-community-card-label">
              <strong>Quick reply speech to text</strong>
              <small>#OPPOFindN2Flip</small>
            </div>
          </div>
          <div className="oppo-community-card">
            <div className="oppo-community-placeholder oppo-community-placeholder-2" />
            <div className="oppo-community-card-label">
              <strong>CAPTURE THE SM:)ING EARTH</strong>
              <small>Winners of the #ShotonOPPO #SmilingEarth day contest</small>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
