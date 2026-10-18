/**
 * One-off de-brand DB pass for the live `apple.footer` row
 * (run: node scripts/fix-footer-row.mjs from the repo root).
 *
 * The row overrides only footnotesHtml / copyright / localeLabel / localeHref;
 * the footer directory + shopHtml + legal row render from data/footer.ts. The
 * code was rewritten to a Gadzio footer in this pass — this script keeps the
 * DB row from reintroducing Apple-brand values on top of it:
 *
 *   localeHref     "/choose-country-region/" (a 404 here) -> "/"
 *   footnotesHtml  -> the de-branded Gadzio footnotes (drops the "Apple devices
 *                     is certified" compatibility claim; keeps the trademark
 *                     notice, which is a legitimate nominative reference)
 *   copyright / localeLabel: kept verbatim unless they carry Apple-brand copy
 *                     ("Gadzio Inc." copyright and "India" label are fine).
 *
 * The `apple.footer` KEY IS NOT RENAMED. If no row exists, nothing is written —
 * the code defaults already render the Gadzio footer. Prints before/after and
 * never prints DATABASE_URL.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import postgres from 'postgres';

const envPath = path.resolve(process.cwd(), '.env.local');
try {
  const env = await readFile(envPath, 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {
  // no .env.local — DATABASE_URL must come from the real environment
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Add it to .env.local and retry.');
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, {
  ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require',
  onnotice: () => {},
});

// Byte-identical to the new FOOTER_FOOTNOTES_HTML in data/footer.ts.
const FOOTNOTES = await (async () => {
  const src = await readFile(
    path.resolve(process.cwd(), 'src/components/sites/www-apple-com-736d3707/root-8a5edab2/data/footer.ts'),
    'utf8',
  );
  const m = src.match(/export const FOOTER_FOOTNOTES_HTML = (".*");/);
  if (!m) throw new Error('could not locate FOOTER_FOOTNOTES_HTML in data/footer.ts');
  return JSON.parse(m[1]);
})();

const show = (v) => JSON.stringify(v, null, 2);

/**
 * The `apple.footer` row was originally seeded as a DOUBLE-ENCODED jsonb value:
 * the column held a JSON *string scalar* (not an object), so postgres.js handed
 * back a plain string and `{ ...value }` spread it into a numeric char map.
 * Normalize every stored shape back to the real object before transforming:
 *   - jsonb string scalar        -> JSON.parse it
 *   - numeric char map ("0":"{"…) -> join + JSON.parse it (repaired corruption)
 *   - plain object               -> as-is
 */
function isCharMap(v) {
  const keys = Object.keys(v);
  if (keys.length === 0) return false;
  let n = 0;
  for (const k of keys) {
    if (!/^\d+$/.test(k) || v[k].length > 1 || typeof v[k] !== 'string') return false;
    if (Number(k) >= n) n = Number(k) + 1;
  }
  return keys.length === n;
}

function normalizeStored(v) {
  if (typeof v === 'string') return JSON.parse(v);
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    if (v.footnotesHtml || v.copyright || v.localeLabel || v.localeHref) return v;
    if (isCharMap(v)) {
      const joined = Object.keys(v)
        .sort((a, b) => Number(a) - Number(b))
        .map((k) => v[k])
        .join('');
      const parsed = JSON.parse(joined);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    }
  }
  throw new Error('unexpected stored shape for apple.footer — refusing to write');
}

const [row] = await sql`select value from content_blocks where key = 'apple.footer'`;
if (!row) {
  console.log('=== apple.footer ===\n  (no DB row — the Gadzio code fallback renders, nothing to write)');
} else {
  const before = normalizeStored(row.value);
  const corrupted = row.value !== before;
  const next = { ...before };
  if (corrupted) {
    console.log('  (stored value was double-encoded/char-mapped — normalizing to a clean jsonb object)');
  }

  const notes = [];
  if (next.footnotesHtml && next.footnotesHtml !== FOOTNOTES) {
    next.footnotesHtml = FOOTNOTES;
    notes.push('footnotesHtml: replaced with the de-branded Gadzio footnotes (certification claim removed)');
  }
  if (typeof next.localeHref === 'string' && next.localeHref === '/choose-country-region/') {
    next.localeHref = '/';
    notes.push('localeHref: "/choose-country-region/" (404) -> "/"');
  }
  if (typeof next.localeHref === 'string' && /apple\.com/i.test(next.localeHref)) {
    next.localeHref = '/';
    notes.push(`localeHref: ${JSON.stringify(before.localeHref)} was an apple.com URL -> "/"`);
  }
  // "Gadzio Inc." / "Gadzio" copyright and "India" locale label are already
  // brand-correct; leave them byte-identical.
  if (typeof next.copyright === 'string' && /\bApple\b/.test(next.copyright)) {
    notes.push(`copyright: ${JSON.stringify(next.copyright)} mentions Apple — left untouched, review manually`);
  }

  console.log('=== apple.footer ===');
  console.log('  before:', show(before));
  console.log('  after :', show(next));
  for (const n of notes) console.log('  * ' + n);

  const stray = notes.some((n) => /review manually/.test(n));
  const stillApple = /apple\.com|1-800-MY-APPLE|Apple Support|Apple Store/i.test(JSON.stringify(next));
  if (stray) {
    console.log('  !! NOT WRITING — unexpected value(s), fix manually and re-run');
  } else if (stillApple) {
    console.log('  !! NOT WRITING — value still contains an Apple brand string after transform');
  } else if (!corrupted && JSON.stringify(next) === JSON.stringify(before)) {
    console.log('  (no change needed)');
  } else {
    // Plain object in, object out — postgres.js serializes it as a jsonb
    // OBJECT (not a string scalar), which is what the render path expects.
    await sql`
      update content_blocks
      set value = ${next}, updated_at = now()
      where key = 'apple.footer'
    `;
    const [check] = await sql`select value from content_blocks where key = 'apple.footer'`;
    console.log('  written ✓  (re-read contains apple.com:', /apple\.com/i.test(JSON.stringify(check.value)), ')');
  }
}

await sql.end();
