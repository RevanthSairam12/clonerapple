/**
 * One-off de-brand DB pass (run: node scripts/fix-apple-destinations.mjs).
 *
 * Replaces the remaining Apple destination URLs inside the live CMS rows with
 * the confirmed internal Gadzio routes, keeping every other field (headlines,
 * subheads, copy, image slots, tooltips, ribbon text) byte-identical:
 *
 *   apple.hero_tiles  tile 0 (Semester, unlocked.) → /in-edu/store
 *                     tile 1 (Everyday Essentials) → /shop/iphone/accessories/cases-protection
 *                     also drops the inert {"label":"","href":""} CTA artifact
 *   apple.ribbon      shopHref → /shop/iphone/accessories/cases-protection
 *   apple.gallery     enabled: false (cards' hrefs are code-side apple.com only)
 *
 * Missing rows are NOT created — the code fallbacks are already de-branded.
 * apple.promo_section (Apple Card stays hidden), nav/footer/locale are untouched.
 * Prints before/after JSON so the change is auditable; never prints DATABASE_URL.
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

const EDU = '/in-edu/store';
const HUB = '/shop/iphone/accessories/cases-protection';

// Hrefs this pass treats as "the old Apple destination" on hero tiles:
// /us/shop/goto/* (with any tail) or exactly /iphone/, optionally qualified
// with an apple.com origin.
function isOldAppleTileHref(href) {
  let path = href;
  if (/^https?:\/\//i.test(href)) {
    if (!/^https?:\/\/(([\w-]+\.)+)?apple\.com(\/|$)/i.test(href)) return false;
    path = href.replace(/^https?:\/\/[^/]+/i, '');
  }
  return /^\/us\/shop\/goto\//i.test(path) || /^\/iphone\/?$/i.test(path);
}

const hasAppleDomain = (v) => /apple\.com/i.test(JSON.stringify(v ?? ''));
const show = (v) => JSON.stringify(v, null, 2);

/* ---------------------------------------------------------------- transforms */

/** @returns {{value: object, notes: string[]} | null} */
function fixHeroTiles(value) {
  const tiles = value?.heroTiles;
  if (!Array.isArray(tiles)) return null;
  const notes = [];
  const next = { ...value, heroTiles: tiles.map((tile, i) => {
    if (tile === null || typeof tile !== 'object') return tile;
    const target = i === 0 ? EDU : i === 1 ? HUB : null;
    if (!target) {
      if (hasAppleDomain(tile)) {
        notes.push(`tile[${i}]: unexpected extra tile still contains an apple.com value — left untouched, review manually`);
      }
      return tile;
    }
    const t = { ...tile };
    if (typeof t.href === 'string' && isOldAppleTileHref(t.href) && t.href !== target) {
      notes.push(`tile[${i}].href: ${JSON.stringify(t.href)} -> ${target}`);
      t.href = target;
    } else if (typeof t.href === 'string' && hasAppleDomain({ x: t.href })) {
      notes.push(`tile[${i}].href: ${JSON.stringify(t.href)} did not match the audited Apple path — left untouched, review manually`);
    }
    if (Array.isArray(t.ctas)) {
      const kept = t.ctas.filter((c) => c && typeof c.label === 'string' && c.label.trim() !== '');
      if (kept.length !== t.ctas.length) {
        notes.push(`tile[${i}].ctas: dropped ${t.ctas.length - kept.length} empty-label artifact CTA(s)`);
      }
      t.ctas = kept.map((c) => {
        if (typeof c.href !== 'string') return c;
        if (isOldAppleTileHref(c.href)) {
          notes.push(`tile[${i}].ctas["${c.label}"].href: ${JSON.stringify(c.href)} -> ${target}`);
          return { ...c, href: target };
        }
        if (hasAppleDomain({ x: c.href })) {
          notes.push(`tile[${i}].ctas["${c.label}"].href: ${JSON.stringify(c.href)} not an audited Apple path — left untouched, review manually`);
        }
        return c;
      });
    }
    return t;
  }) };
  return { value: next, notes };
}

function fixRibbon(value) {
  const notes = [];
  if (typeof value?.shopHref !== 'string') return null;
  if (value.shopHref === HUB) return null;
  if (!/apple\.com/i.test(value.shopHref)) {
    notes.push(`ribbon.shopHref: ${JSON.stringify(value.shopHref)} is not an apple.com URL — left untouched, review manually`);
    return { value, notes };
  }
  notes.push(`ribbon.shopHref: ${JSON.stringify(value.shopHref)} -> ${HUB}`);
  return { value: { ...value, shopHref: HUB }, notes };
}

function fixGallery(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.enabled === false) return null;
  return {
    value: { ...value, enabled: false },
    notes: ['gallery.enabled: -> false (card hrefs are code-side apple.com; row kept so the editor toggle still works)'],
  };
}

const PLAN = [
  { key: 'apple.hero_tiles', fix: fixHeroTiles },
  { key: 'apple.ribbon', fix: fixRibbon },
  { key: 'apple.gallery', fix: fixGallery },
];

/* ---------------------------------------------------------------------- run */

let failed = false;
for (const { key, fix } of PLAN) {
  const [row] = await sql`select value from content_blocks where key = ${key}`;
  if (!row) {
    console.log(`\n=== ${key} ===\n  (no DB row — code fallback is already de-branded, nothing to write)`);
    continue;
  }
  const result = fix(row.value);
  if (!result) {
    console.log(`\n=== ${key} ===\n  (no change needed)`);
    continue;
  }
  console.log(`\n=== ${key} ===`);
  console.log('  before:', show(row.value));
  console.log('  after :', show(result.value));
  for (const note of result.notes) console.log('  * ' + note);

  if (result.notes.some((n) => /review manually/.test(n))) {
    console.log(`  !! NOT WRITING ${key} — unexpected value(s), fix manually and re-run`);
    failed = true;
    continue;
  }
  if (hasAppleDomain(result.value)) {
    console.log(`  !! NOT WRITING ${key} — value still contains apple.com after transform`);
    failed = true;
    continue;
  }
  await sql`
    update content_blocks
    set value = ${JSON.parse(JSON.stringify(result.value))}, updated_at = now()
    where key = ${key}
  `;
  const [check] = await sql`select value from content_blocks where key = ${key}`;
  console.log('  written ✓  (re-read contains apple.com:', hasAppleDomain(check.value), ')');
}

await sql.end();
if (failed) process.exit(2);
