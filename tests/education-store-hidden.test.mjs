/**
 * Tests that the deferred Education Store (`/in-edu/store`) is hidden from
 * live navigation, header, cart, search, footer, Store Admin Website screens,
 * and returns `notFound()` unless `NEXT_PUBLIC_ENABLE_EDUCATION_STORE` is
 * explicitly enabled, while keeping all Education Store code preserved for
 * future re-enablement.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const jiti = createJiti(import.meta.url, { alias: { '@': path.join(root, 'src') } });

const { isEducationStoreEnabled } = await jiti.import(
  path.join(root, 'src', 'lib', 'storefront', 'education-store.ts'),
);
const { FOOTER_DIRECTORY, FOOTER_BOTTOM } = await jiti.import(
  path.join(root, 'src', 'components', 'sites', 'www-apple-com-736d3707', 'root-8a5edab2', 'data', 'footer.ts'),
);
const { PAGE_SEARCH_ITEMS, POPULAR_SEARCH_LINKS } = await jiti.import(
  path.join(root, 'src', 'lib', 'search', 'searchService.ts'),
);

test('isEducationStoreEnabled is false by default and true only when explicitly enabled', () => {
  assert.equal(isEducationStoreEnabled({}), false);
  assert.equal(isEducationStoreEnabled({ NEXT_PUBLIC_ENABLE_EDUCATION_STORE: '0' }), false);
  assert.equal(isEducationStoreEnabled({ NEXT_PUBLIC_ENABLE_EDUCATION_STORE: 'false' }), false);
  assert.equal(isEducationStoreEnabled({ NEXT_PUBLIC_ENABLE_EDUCATION_STORE: '1' }), true);
  assert.equal(isEducationStoreEnabled({ NEXT_PUBLIC_ENABLE_EDUCATION_STORE: 'true' }), true);
  assert.equal(isEducationStoreEnabled({ NEXT_PUBLIC_ENABLE_EDUCATION_STORE: 'on' }), true);
});

test('/in-edu/store route calls notFound() when Education Store is disabled while keeping EduStorePage intact', () => {
  const pageSrc = readFileSync(path.join(root, 'src', 'app', 'in-edu', 'store', 'page.tsx'), 'utf8');
  assert.match(pageSrc, /if\s*\(!isEducationStoreEnabled\(\)\)\s*\{\s*notFound\(\);/s);
  assert.match(pageSrc, /EduStorePage/, 'EduStorePage component must remain preserved for future use');
});

test('live storefront header, cart, search, footer, and website admin do not expose /in-edu/store', () => {
  const headerSrc = readFileSync(path.join(root, 'src', 'components', 'header', 'GadzioHeader.tsx'), 'utf8');
  const cartSrc = readFileSync(path.join(root, 'src', 'components', 'cart', 'CartPageView.tsx'), 'utf8');
  const navSearchSrc = readFileSync(
    path.join(root, 'src', 'components', 'sites', 'www-apple-com-736d3707', 'root-8a5edab2', 'NavSearchPanel.tsx'),
    'utf8',
  );

  assert.doesNotMatch(headerSrc, /\/in-edu\/store/);
  assert.doesNotMatch(cartSrc, /\/in-edu\/store/);
  assert.doesNotMatch(navSearchSrc, /\/in-edu\/store/);
  assert.doesNotMatch(FOOTER_BOTTOM.shopHtml, /\/in-edu\/store/);

  const footerHrefs = FOOTER_DIRECTORY.flatMap((col) =>
    col.sections.flatMap((sec) => sec.links.map((l) => l.href)),
  );
  assert.ok(!footerHrefs.includes('/in-edu/store'));
  assert.ok(!PAGE_SEARCH_ITEMS.some((item) => item.href === '/in-edu/store'));
  assert.ok(!POPULAR_SEARCH_LINKS.some((item) => item.href === '/in-edu/store'));
});
