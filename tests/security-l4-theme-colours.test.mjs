/**
 * SECURITY (L-4): theme colours were interpolated verbatim into a `<style>`
 * element in the root layout. A stored value could close the element and add
 * markup, or add extra CSS declarations.
 *
 * Only complete hex colours are emitted now; every other value is ignored and
 * the coded token applies. The save seam enforces the same rule.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const jiti = createJiti(import.meta.url, {
  alias: { '@': path.join(root, 'src') },
});

const { isThemeColorKey, isThemeHexColor, safeThemeColor } = await jiti.import(
  path.join(root, 'src', 'lib', 'website', 'theme-rules.ts'),
);

test('only complete hex colours are accepted', () => {
  for (const valid of ['#006D2E', '#fff', '#00a040ff', '  #005524  ']) {
    assert.equal(isThemeHexColor(valid), true, valid);
    assert.equal(safeThemeColor(valid), valid.trim());
  }

  for (const invalid of [
    'red',
    '#12345',
    '#006D2E0',
    '#006D2E; } body { display: none',
    '</style><script>alert(1)</script>',
    'var(--x)',
    'url(https://attacker.test/x)',
    '',
    null,
    undefined,
    42,
  ]) {
    assert.equal(isThemeHexColor(invalid), false, String(invalid));
    assert.equal(safeThemeColor(invalid), null);
  }
});

test('the three theme colour keys are the guarded set', () => {
  assert.equal(isThemeColorKey('oppoPrimaryColor'), true);
  assert.equal(isThemeColorKey('oppoGreenDark'), true);
  assert.equal(isThemeColorKey('oppoGreenLight'), true);
  assert.equal(isThemeColorKey('fontFamily'), false);
});

test('the root layout never interpolates an unvalidated colour', async () => {
  const source = await readFile(path.join(root, 'src', 'app', 'layout.tsx'), 'utf8');
  assert.match(source, /safeThemeColor\(settings\.oppoPrimaryColor\)/);
  assert.match(source, /safeThemeColor\(settings\.oppoGreenDark\)/);
  assert.match(source, /safeThemeColor\(settings\.oppoGreenLight\)/);
  assert.doesNotMatch(source, /--oppo-green: \$\{settings\./);
});

test('the save seam refuses a non-hex colour', async () => {
  const source = await readFile(
    path.join(root, 'src', 'lib', 'website', 'content-store.ts'),
    'utf8',
  );
  assert.match(source, /isThemeColorKey\(key\) && !isThemeHexColor\(value\)/);
  assert.match(source, /Theme colours must be a hex value/);
});
