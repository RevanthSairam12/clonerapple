#!/usr/bin/env node
// Standalone test-only loopback server. Does not start Next, load env files, or access a backend.
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { webpack } = require('next/dist/compiled/webpack/webpack');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputArg = process.argv.indexOf('--output');
const output = outputArg === -1 ? path.join(root, 'tmp/product-admin-ui-20261103') : path.resolve(root, process.argv[outputArg + 1] ?? '');
const relativeOutput = path.relative(path.join(root, 'tmp'), output);
if (!relativeOutput || relativeOutput.startsWith('..') || path.isAbsolute(relativeOutput)) throw new Error('Output must be under tmp.');
const entry = path.join(root, 'tests/helpers/product-admin-ui-fixture.tsx');
const portArg = process.argv.indexOf('--port');
const port = portArg === -1 ? 43127 : Number(process.argv[portArg + 1]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Use --port with an integer from 1024 to 65535.');
await mkdir(output, outputArg === -1 ? { recursive: true } : {});
const aliases = Object.fromEntries(['next/navigation', 'next/link', '@/lib/store-admin/auth', '@/lib/store-admin/catalog', '@/lib/store-admin/product-metadata'].map(name => [`${name}$`, entry]));
const base = {
  mode: 'development', context: root, entry, devtool: false,
  resolve: { extensions: ['.tsx', '.ts', '.js', '.mjs'], alias: { ...aliases, '@': path.join(root, 'src') } },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(root, 'tests/helpers/product-admin-ui-fixture-loader.cjs') }] },
  optimization: { minimize: false },
  plugins: [{ apply(compiler) {
    compiler.hooks.normalModuleFactory.tap('FixtureBackendBoundary', factory => {
      factory.hooks.afterResolve.tap('FixtureBackendBoundary', result => {
        const resource = (result.createData.resource || '').replaceAll('\\', '/');
        if (resource.includes('/src/lib/platform/') || (resource.includes('/src/lib/store-admin/') && !/\/(?:money|catalog-rules|product-option-combinations)\.ts$/.test(resource))) {
          throw new Error(`Fixture refuses backend module: ${resource}`);
        }
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
const { createFixture } = require(path.join(output, 'fixture-server.cjs'));
const { renderToString } = require('react-dom/server');
// Basic host layout plus the utility reset/layout needed by the unbuilt Tailwind class names.
// Product styling, help disclosures and responsive rules come from the real admin stylesheet.
const hostCss = `body{margin:0} .fixture-main{max-width:1440px;margin:auto;padding:24px;min-width:0}.fixture-banner{margin-bottom:24px;padding:12px;background:#fff3cd;color:#554200;font:13px system-ui}.min-w-0{min-width:0}.border-0{border:0}.p-0{padding:0}.m-0{margin:0}.w-full{width:100%}.flex{display:flex}.flex-wrap{flex-wrap:wrap}.gap-2{gap:8px}.space-y-2>*+*{margin-top:8px}.space-y-3>*+*{margin-top:12px}.space-y-4>*+*{margin-top:16px}.sticky{position:sticky}.bottom-0{bottom:0}.z-20{z-index:20}.bg-white{background:white}.scroll-mt-6{scroll-margin-top:24px}.rounded{border-radius:4px}.border{border:1px solid #ddd}.p-2{padding:8px}.p-3{padding:12px}.p-4{padding:16px}nav ol{list-style:none;padding:0}fieldset{min-inline-size:0}@media(min-width:1024px){.lg\\:grid{display:grid}.lg\\:grid-cols-\\[210px_minmax\\(0\\,1fr\\)\\]{grid-template-columns:210px minmax(0,1fr)}.lg\\:gap-6{gap:24px}.lg\\:sticky{position:sticky}.lg\\:top-6{top:24px}.lg\\:self-start{align-self:start}}@media(max-width:600px){.fixture-main{padding:12px}}`;
const allowedModes = new Set(['add', 'add-owner', 'edit', 'edit-owner', 'shared-owner', 'viewer', 'list', 'list-viewer', 'colours-owner', 'colours-viewer', 'models-owner', 'models-viewer']);
const server = http.createServer(async (request, response) => {
  try {
    if (request.method !== 'GET') { response.writeHead(405).end('GET only'); return; }
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'");
    if (url.pathname === '/fixture-browser.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(await readFile(path.join(output, 'fixture-browser.js'))); return; }
    if (url.pathname === '/admin.css') { response.setHeader('Content-Type', 'text/css'); response.end(await readFile(path.join(root, 'src/app/(store-admin)/store-admin/store-admin.css'))); return; }
    if (url.pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
    // Synthetic, empty Media library so the photo picker renders its real empty
    // state in the fixture. Uploads remain disabled (GET only, no backend).
    if (url.pathname === '/api/store-admin/media') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ media: [] })); return; }
    if (url.pathname !== '/' || !allowedModes.has(url.searchParams.get('mode') || 'edit')) { response.writeHead(404).end('No fixture here'); return; }
    const markup = renderToString(await createFixture(url.search));
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Product admin UI — test fixture</title><link rel="stylesheet" href="/admin.css"><style>${hostCss}</style></head><body class="sa-shell"><div id="root">${markup}</div><script defer src="/fixture-browser.js"></script></body></html>`);
  } catch (error) { console.error(error); response.writeHead(500).end('Fixture render failed'); }
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', async () => {
  await writeFile(path.join(output, 'server.json'), JSON.stringify({ origin: `http://127.0.0.1:${port}`, pid: process.pid, fixtureOnly: true }, null, 2));
  console.log(`Product UI fixture ready at http://127.0.0.1:${port} (synthetic data; no backend)`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
