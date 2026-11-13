import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { createJiti } from 'jiti';

const nativeRequire = createRequire(import.meta.url);
const root = path.resolve('.');
const jiti = createJiti(import.meta.url, { alias: { '@': path.join(root, 'src') } });
const quoteRules = await jiti.import(path.join(root, 'src/lib/checkout/client-quote.ts'));
const shippingRules = await jiti.import(path.join(root, 'src/lib/checkout/shipping-rules.ts'));
const decisionRules = await jiti.import(path.join(root, 'src/lib/checkout/checkout-decision.ts'));
const cartIds = await jiti.import(path.join(root, 'src/lib/cart/cart-id.ts'));
const recoveryRules = await jiti.import(path.join(root, 'src/lib/checkout/payment-recovery.ts'));
export const policy = { enabled: false, chargePaise: 0, freeShippingThresholdPaise: null };
export const variant = { id: 'exact', sku: 'EXACT', label: 'Original option', pricePaise: 10000, inStock: true };

// Execute the actual component/event handlers with a minimal hook host. Every
// external side effect is injected; unlisted imports and gateway submission fail.
export function checkoutFixture() {
  const states = []; let cursor = 0;
  let lines = [{ id: 'case::variant::exact', productId: 'case', variantId: 'exact', variantLabel: variant.label, name: 'Case', price: 100, quantity: 1 }];
  let products = [{ id: 'case', inventoryMode: 'variant', pricePaise: 10000, inStock: true, purchasableVariants: [variant] }];
  let response = async () => ({ status: 409, ok: false, json: async () => ({ code: 'selection_unavailable', selection: { id: 'case', variantId: 'exact' } }) });
  let requests = 0, syncs = 0, removals = 0, submissions = 0;
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in states)) states[index] = initial; return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }]; },
    useRef(initial) { const index = cursor++; return states[index] ??= { current: initial }; },
    useEffect() {},
  };
  const stubs = {
    react: { ...hooks, default: hooks },
    'react/jsx-runtime': nativeRequire('react/jsx-runtime'),
    'next/link': { default: 'a' },
    '@/lib/cart/CartContext': { useCart: () => ({ items: lines, isHydrated: true, removeItem() { removals++; }, syncPrices(updates) { syncs++; lines = lines.map(line => ({ ...line, price: updates[0].unitPaise / 100 })); } }) },
    '@/lib/checkout/client-quote': quoteRules,
    '@/lib/checkout/shipping-rules': shippingRules,
    '@/lib/checkout/checkout-decision': decisionRules,
    '@/lib/cart/cart-id': cartIds,
    '@/lib/checkout/useCheckoutRefresh': { useCheckoutRefresh() {} },
    '@/lib/checkout/payment-recovery': recoveryRules,
    '@/lib/storefront/use-availability': { verifyAvailabilityLines: async () => true },
    '@/lib/cart/useCoupon': { useCoupon: ({ subtotalPaise, shippingPaise }) => ({ input: '', appliedCode: null, applied: null, busy: false, totals: { subtotalPaise, shippingPaise, discountPaise: 0, totalPaise: subtotalPaise + shippingPaise }, revalidate: async () => null, remove() { throw new Error('Unexpected coupon removal'); } }) },
    '@/components/cart/CouponBox': { CouponBox: 'coupon' },
    '@/lib/free-gifts/useCartFreeGifts': { useCartFreeGifts: () => ({ evaluation: null, loading: false, refresh: async () => {} }) },
    '@/components/cart/FreeGiftCartWidgets': {
      FreeGiftConflictNotice: () => null,
      FreeGiftLineRow: () => null,
      FreeGiftProgressNudgeBanner: () => null,
      FreeGiftUnavailablePrompt: () => null,
    },
    '@/lib/checkout/india-validation': { INDIAN_STATES: [], normalizeIndianMobile: value => value, normalizeIndianState: value => value, validateCheckoutContact: () => ({ ok: true, value: { phone: '9876543210' } }), validateIndianAddress: value => ({ ok: true, value }), checkoutFieldErrors: () => ({}) },
    '@/lib/store-admin/money': { formatRupees: value => String(value) },
  };
  const filename = path.join(root, 'src/components/checkout/CheckoutForm.tsx');
  const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports,
    require(name) { if (!(name in stubs)) throw new Error(`Forbidden component dependency: ${name}`); return stubs[name]; },
    fetch: async url => { assert.equal(url, '/api/payu/initiate'); requests++; return response(); },
    document: { getElementById: () => null, createElement() { submissions++; throw new Error('Gateway form submission forbidden'); } },
    window: { history: { replaceState() {} } }, console,
  }, { filename });
  const render = () => { cursor = 0; return module.exports.CheckoutForm({ initialProducts: products, shippingPolicy: policy, couponsEnabled: false }); };
  const visit = (node, predicate) => {
    if (!node || typeof node !== 'object') return null;
    if (predicate(node)) return node;
    for (const child of [node.props?.children].flat(Infinity)) { const found = visit(child, predicate); if (found) return found; }
    return null;
  };
  const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : [node.props?.children].flat(Infinity).map(text).join(' ');
  return {
    render, visit, text,
    submit: tree => visit(tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} }),
    respond(next) { response = next; },
    replaceProducts(next) { products = next; },
    counts: () => ({ requests, syncs, removals, submissions }),
  };
}
