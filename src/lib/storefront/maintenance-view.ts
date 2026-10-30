/**
 * The maintenance page as data, and as a standalone HTML document.
 *
 * One module owns the copy so the real `/maintenance` page and the 503 body
 * the proxy returns to blocked requests cannot drift. The HTML build is
 * deliberately self-contained (inline CSS, no fonts, no scripts) so it renders
 * correctly even when the stylesheet chunk is the thing that failed.
 */

import {
  formatEndsAt,
  maintenanceMessage,
  type MaintenanceState,
} from './maintenance';

export interface MaintenanceView {
  storeName: string;
  title: string;
  message: string;
  /** Already formatted in the store timezone, or null. */
  endsAtLabel: string | null;
  timeZone: string;
}

export function maintenanceView(state: MaintenanceState): MaintenanceView {
  const storeName = state.storeName.trim() || 'Gadzio';
  return {
    storeName,
    title: `${storeName} is getting a quick tune-up`,
    message: maintenanceMessage(state),
    endsAtLabel: formatEndsAt(state.endsAt, state.timeZone),
    timeZone: state.timeZone,
  };
}

/** HTML-escape every interpolated value. The message is owner-authored text. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * A complete, standalone HTML document. Used as the 503 body for blocked
 * storefront requests; the `/maintenance` page renders the same content.
 */
export function renderMaintenanceDocument(view: MaintenanceView): string {
  const ends = view.endsAtLabel
    ? `<p class="ends">We expect to be back by <strong>${esc(view.endsAtLabel)}</strong> (${esc(view.timeZone)}).</p>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(view.title)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: #f5f5f7;
    color: #1d1d1f;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  main {
    width: 100%;
    max-width: 560px;
    background: #fff;
    border-radius: 20px;
    padding: 48px 40px;
    text-align: center;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.06);
  }
  .mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 52px;
    height: 52px;
    margin-bottom: 22px;
    border-radius: 14px;
    background: #1d1d1f;
    color: #fff;
    font-size: 24px;
    line-height: 1;
  }
  .store { margin: 0 0 8px; font-size: 13px; letter-spacing: .12em; text-transform: uppercase; color: #6e6e73; }
  h1 { margin: 0 0 14px; font-size: 28px; line-height: 1.2; letter-spacing: -.01em; }
  p { margin: 0 auto; max-width: 430px; font-size: 16px; line-height: 1.55; color: #424245; }
  .ends { margin-top: 16px; font-size: 15px; color: #6e6e73; }
  .note { margin-top: 28px; font-size: 13px; color: #86868b; }
</style>
</head>
<body>
<main>
  <div class="mark" aria-hidden="true">-</div>
  <p class="store">${esc(view.storeName)}</p>
  <h1>${esc(view.title)}</h1>
  <p>${esc(view.message)}</p>
  ${ends}
  <p class="note">Store staff can keep working in the admin panel while this page is shown.</p>
</main>
</body>
</html>`;
}
