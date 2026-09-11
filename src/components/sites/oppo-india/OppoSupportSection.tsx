const SUPPORT_ITEMS = [
  'Authenticity and Warranty Status Check',
  'Service Centers & Reservation',
  'Contact Us',
  'Find More Service',
  'Retail Store Locator',
];

export function OppoSupportSection() {
  return (
    <section className="oppo-support">
      <h2 className="oppo-support-title">OPPO Support</h2>
      <div className="oppo-support-list">
        {SUPPORT_ITEMS.map((item) => (
          <a key={item} href="#" className="oppo-support-item">
            <span>{item}</span>
            <span className="oppo-support-item-arrow">→</span>
          </a>
        ))}
      </div>
    </section>
  );
}
