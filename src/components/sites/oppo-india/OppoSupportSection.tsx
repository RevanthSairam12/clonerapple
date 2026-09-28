import type { OppoCommunityOverride } from './admin-overrides';

export function OppoSupportSection({
  heading = 'OPPO Support',
  items,
}: {
  heading?: string;
  items?: string[];
} = {}) {
  // Override array length wins — an added item is whatever text the editor set.
  const supportItems = items
    ? items.map((label) => label || 'Untitled link')
    : DEFAULT_ITEMS;

  return (
    <section className="oppo-support">
      <h2 className="oppo-support-title">{heading}</h2>
      <div className="oppo-support-list">
        {supportItems.map((item, i) => (
          <a key={`${item}-${i}`} href="#" className="oppo-support-item">
            <span>{item}</span>
            <span className="oppo-support-item-arrow">→</span>
          </a>
        ))}
      </div>
    </section>
  );
}

const DEFAULT_ITEMS = [
  'Authenticity and Warranty Status Check',
  'Service Centers & Reservation',
  'Contact Us',
  'Find More Service',
  'Retail Store Locator',
];
