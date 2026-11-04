import test from 'node:test';
import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url);
const { resolveEffectivePrice } = await jiti.import('../src/lib/storefront/pricing.ts');
const parent = { pricePaise: 100000, salePricePaise: 80000 };
for (const [name, option, live, expected] of [
  ['blank inherits regular', { pricePaise: null }, false, 100000],
  ['blank inherits sale', { pricePaise: null }, true, 80000],
  ['own regular blocks parent sale', { pricePaise: 120000 }, true, 120000],
  ['same-valued override still blocks parent sale', { pricePaise: 100000 }, true, 100000],
  ['own sale wins', { pricePaise: 120000, salePricePaise: 110000 }, true, 110000],
  ['own sale with inherited regular', { pricePaise: null, salePricePaise: 90000 }, true, 90000],
  ['sale expiry restores option regular', { pricePaise: 120000, salePricePaise: 110000 }, false, 120000],
  ['invalid own sale does not fall back to parent sale', { pricePaise: 120000, salePricePaise: 130000 }, true, 120000],
]) test(name, () => assert.equal(resolveEffectivePrice(parent, live, option).unitPaise, expected));
