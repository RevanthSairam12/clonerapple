#!/usr/bin/env node
// Standalone loopback fixture: never starts Next or loads env/backend modules.
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { webpack } = require('next/dist/compiled/webpack/webpack');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'tmp/catalog-workspace-20261103');
const entry = path.join(root, 'tests/helpers/catalog-workspace-fixture.tsx');
const portArg = process.argv.indexOf('--port');
const port = portArg === -1 ? 43128 : Number(process.argv[portArg + 1]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Use a port from 1024 to 65535.');
await mkdir(output, { recursive: true });
const base = {
  mode: 'development', context: root, entry, devtool: false,
  resolve: { extensions: ['.tsx', '.ts', '.js', '.mjs'], alias: { 'next/navigation$': entry, '@': path.join(root, 'src') } },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(root, 'tests/helpers/product-admin-ui-fixture-loader.cjs') }] },
  optimization: { minimize: false },
  plugins: [{ apply(compiler) {
    compiler.hooks.normalModuleFactory.tap('CatalogFixtureBoundary', factory => {
      factory.hooks.afterResolve.tap('CatalogFixtureBoundary', result => {
        const resource = (result.createData.resource || '').replaceAll('\\', '/');
        if (resource.includes('/src/lib/platform/') || (resource.includes('/src/lib/store-admin/') && !/\/(?:money|catalog-rules|product-option-combinations)\.ts$/.test(resource)) || /\/(?:postgres|@supabase|dotenv)\//.test(resource)) throw new Error(`Fixture refuses backend module: ${resource}`);
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
const hostCss = `body{margin:0}.fixture-main{max-width:1440px;margin:auto;padding:24px;min-width:0}.fixture-banner{margin-bottom:20px;padding:12px;background:#fff3cd;color:#554200;font:13px system-ui}[hidden]{display:none!important}.min-w-0{min-width:0}.border-0{border:0}.p-0{padding:0}.m-0{margin:0}.sticky{position:sticky}.bottom-0{bottom:0}.z-20{z-index:20}.bg-white{background:white}.w-full{width:100%}fieldset{min-inline-size:0}nav ol{list-style:none;padding:0}@media(max-width:600px){.fixture-main{padding:12px}}`;
const server = http.createServer(async (request, response) => {
  try {
    if (request.method !== 'GET') { response.writeHead(405).end('GET only'); return; }
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; font-src 'self'; object-src 'none'");
    if (url.pathname === '/fixture-browser.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(await readFile(path.join(output, 'fixture-browser.js'))); return; }
    if (url.pathname === '/admin.css') { response.setHeader('Content-Type', 'text/css'); response.end(await readFile(path.join(root, 'src/app/(store-admin)/store-admin/store-admin.css'))); return; }
    if (url.pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
    if (!['/', '/store-admin/catalog'].includes(url.pathname)) { response.writeHead(404).end('No fixture here'); return; }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Catalogue workspace fixture</title><link rel="stylesheet" href="/admin.css"><style>${hostCss}</style></head><body class="sa-shell"><div id="root">${renderToString(createFixture(url.search))}</div><script defer src="/fixture-browser.js"></script></body></html>`);
  } catch (error) { console.error(error); response.writeHead(500).end('Fixture render failed'); }
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', async () => {
  await writeFile(path.join(output, 'server.json'), JSON.stringify({ origin: `http://127.0.0.1:${port}`, pid: process.pid, fixtureOnly: true }, null, 2));
  console.log(`Catalogue fixture ready at http://127.0.0.1:${port} (synthetic; no backend)`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
