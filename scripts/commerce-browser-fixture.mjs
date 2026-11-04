#!/usr/bin/env node
// Loopback-only synthetic component fixture. No Next server, env files, DB or payment calls.
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { webpack } = require('next/dist/compiled/webpack/webpack');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'tmp/commerce-browser-fixture');
const entry = path.join(root, 'tests/helpers/commerce-browser-fixture.tsx');
const mocks = path.join(root, 'tests/helpers/commerce-browser-fixture-mocks.tsx');
const portArg = process.argv.indexOf('--port');
const port = portArg === -1 ? 0 : Number(process.argv[portArg + 1]);
if (!Number.isInteger(port) || (port !== 0 && (port < 1024 || port > 65535))) throw new Error('Use --port 0 (fresh OS-selected port) or an unused port from 1024 to 65535.');
await mkdir(output, { recursive: true });
const aliases = Object.fromEntries(['next/navigation', 'next/link',
  '@/components/sites/www-apple-com-736d3707/root-8a5edab2/GlobalNav',
  '@/components/sites/www-apple-com-736d3707/root-8a5edab2/GlobalFooter',
  '@/components/trust/GadzioTrustBar', '@/lib/search/searchTracker', '@/lib/checkout/useCheckoutRefresh'].map(name => [`${name}$`, mocks]));
const allowedLibs = new Set(['cart/CartContext.tsx', 'cart/cart-id.ts', 'cart/useCoupon.ts', 'storefront/selection.ts',
  'storefront/use-availability.ts', 'storefront/availability-rules.ts', 'storefront/use-purchase-action.ts', 'checkout/client-quote.ts', 'checkout/payment-recovery.ts',
  'checkout/checkout-decision.ts', 'checkout/shipping-rules.ts', 'checkout/india-validation.ts', 'store-admin/money.ts', 'catalog/product-description.ts']);
const modules = new Set();
const base = {
  mode: 'development', context: root, entry, devtool: false,
  resolve: { extensions: ['.tsx', '.ts', '.js', '.mjs'], alias: { ...aliases, '@': path.join(root, 'src') } },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(root, 'tests/helpers/product-admin-ui-fixture-loader.cjs') }] },
  optimization: { minimize: false },
  plugins: [{ apply(compiler) {
    compiler.hooks.normalModuleFactory.tap('CommerceFixtureBackendBoundary', factory => {
      factory.hooks.beforeResolve.tap('CommerceFixtureBackendBoundary', result => {
        if (result && /^(?:node:|postgres(?:\/|$)|@supabase\/|dotenv(?:\/|$)|server-only$|next\/(?:headers|server)$)/.test(result.request)) throw new Error(`Fixture refuses backend import: ${result.request}`);
      });
      factory.hooks.afterResolve.tap('CommerceFixtureBackendBoundary', result => {
        const resource = (result.createData.resource || '').replaceAll('\\', '/');
        const relative = path.relative(root, resource).replaceAll('\\', '/');
        if (relative.startsWith('src/lib/') && !allowedLibs.has(relative.slice('src/lib/'.length))) throw new Error(`Fixture refuses non-allowlisted application module: ${relative}`);
        if (relative.startsWith('src/app/') || /\/(?:postgres|@supabase|dotenv)\//.test(resource)) throw new Error(`Fixture refuses backend module: ${relative}`);
        if (relative.startsWith('src/')) modules.add(relative);
      });
    });
  } }],
};
async function compile(config) {
  await new Promise((resolve, reject) => {
    const compiler = webpack(config);
    compiler.run((error, stats) => compiler.close(closeError => {
      if (error || closeError) reject(error || closeError);
      else if (stats.hasErrors()) reject(new Error(stats.toString({ all: false, errors: true })));
      else resolve();
    }));
  });
}
await compile({ ...base, target: 'web', output: { path: output, filename: 'fixture-browser.js' } });
await compile({ ...base, target: 'node', externals: { react: 'commonjs react', 'react/jsx-runtime': 'commonjs react/jsx-runtime', 'react-dom/client': 'commonjs react-dom/client' }, output: { path: output, filename: 'fixture-server.cjs', library: { type: 'commonjs2' } } });
// Fixture CSS only: explicit sources, no application build/config/font or remote assets.
const sourceFiles = [...modules].filter(name => /\.tsx$/.test(name)).concat('tests/helpers/commerce-browser-fixture.tsx', 'tests/helpers/commerce-browser-fixture-mocks.tsx');
const cssInput = `@import "tailwindcss" source(none);\n${sourceFiles.map(name => `@source "${path.join(root, name).replaceAll('\\', '/')}";`).join('\n')}\n@theme { --breakpoint-anav: 834px; }\nbody{margin:0;font-family:system-ui,sans-serif}.fixture-banner{padding:12px;background:#fff3cd;font:13px system-ui}.fixture-probe{padding:8px 16px;background:#f5f5f7;font:12px system-ui}.fixture-probe pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:70px;overflow:auto}nav[aria-label="Synthetic fixture navigation"],footer{padding:12px} .gz-storefront-page{--cp-nav-height:0px}\n`;
const postcss = require('postcss');
const tailwind = require('@tailwindcss/postcss');
const css = await postcss([tailwind({ base: root, optimize: false })]).process(cssInput, { from: path.join(root, 'commerce-fixture-input.css') });
await writeFile(path.join(output, 'fixture.css'), css.css);
const sourceHashes = Object.fromEntries(await Promise.all([...modules].sort().map(async name => [name, createHash('sha256').update(await readFile(path.join(root, name))).digest('hex')])));
await writeFile(path.join(output, 'build.json'), JSON.stringify({ fixtureOnly: true, builtAt: new Date().toISOString(), sourceHashes, backendImportAllowlist: [...allowedLibs], applicationModules: [...modules].sort(), aliases: Object.keys(aliases), cssSources: sourceFiles }, null, 2));
const { createFixture } = require(path.join(output, 'fixture-server.cjs'));
const { renderToString } = require('react-dom/server');
const modes = new Set(['case', 'accessory', 'shared', 'cart', 'checkout', 'buy-again']);
const server = http.createServer(async (request, response) => {
  try {
    if (request.method !== 'GET') { response.writeHead(405).end('GET only — synthetic API is in browser memory'); return; }
    const url = new URL(request.url, 'http://127.0.0.1');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; form-action 'none'; font-src 'none'; object-src 'none'; base-uri 'none'");
    if (url.pathname === '/fixture-browser.js' || url.pathname === '/fixture.css') {
      response.setHeader('Content-Type', url.pathname.endsWith('.js') ? 'application/javascript' : 'text/css');
      response.end(await readFile(path.join(output, url.pathname.slice(1)))); return;
    }
    if (url.pathname === '/fixture-photo.svg') { response.setHeader('Content-Type', 'image/svg+xml'); response.end('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240"><rect x="65" y="20" width="110" height="200" rx="20" fill="#0055cc"/><text x="120" y="125" text-anchor="middle" fill="white" font-size="16">FIXTURE</text></svg>'); return; }
    if (url.pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
    if (url.pathname !== '/' || !modes.has(url.searchParams.get('mode') || 'case')) { response.writeHead(404).end('No fixture here'); return; }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="commerce-fixture" content="synthetic-only"><title>Synthetic commerce component fixture</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="root">${renderToString(createFixture(url.search))}</div><script defer src="/fixture-browser.js"></script></body></html>`);
  } catch (error) { console.error(error); response.writeHead(500).end('Fixture render failed'); }
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', async () => {
  const assignedPort = server.address().port;
  await writeFile(path.join(output, 'server.json'), JSON.stringify({ origin: `http://127.0.0.1:${assignedPort}`, pid: process.pid, fixtureOnly: true }, null, 2));
  console.log(`Commerce component fixture ready at http://127.0.0.1:${assignedPort} (synthetic only)`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
