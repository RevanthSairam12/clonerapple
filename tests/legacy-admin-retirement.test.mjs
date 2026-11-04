import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const oldTables = /\b(?:admin_users|admin_sessions)\b/;
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = `${dir}/${entry.name}`;
    return entry.isDirectory() ? files(full) : /\.(?:[cm]?js|tsx?)$/.test(entry.name) ? [full] : [];
  });
}

test('legacy table dependencies cannot spread while removal waits for browser verification', () => {
  // Remove these transitional exceptions WITH the legacy panel, not before
  // its manual verification gate. After removal, the scan becomes strict.
  const transitional = new Set([
    'src/lib/admin/auth.ts',
    'src/lib/admin/totp-store.ts',
    'src/lib/store-admin/auth.ts', // identity-separation comment
    'scripts/create-editor.mjs',
    'scripts/migrate-legacy-admins.mjs',
    'scripts/migrate.mjs', // historical migration comment
  ]);
  const retained = new Set([
    'scripts/check-account-routes.mjs', // defensive forbidden-identity pattern, not access
  ]);
  const legacyPresent = existsSync('src/app/(admin)');
  const references = [...files('src'), ...files('scripts')]
    .filter(file => oldTables.test(readFileSync(file, 'utf8')));
  const unexpected = references.filter(file => !retained.has(file) && !(legacyPresent && transitional.has(file)));
  assert.deepEqual(unexpected, [], 'New legacy identity references, or unfinished cleanup after panel removal');
});

function load(file, imports, logs = []) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    module, exports: module.exports, Response,
    console: { info: message => logs.push(JSON.parse(message)) },
    require(name) {
      if (imports[name]) return imports[name];
      throw new Error(`Unexpected retired endpoint import: ${name}`);
    },
  });
  return module.exports;
}

test('all retired handlers return no-store 410 without reading credentials or request data', async () => {
  const logs = [];
  const helper = load('src/lib/website/legacy-gone.ts', {}, logs);
  const imports = { '@/lib/website/legacy-gone': helper };
  const retired = files('src/app/api/admin').filter(file => !file.includes('media/[id]/'));
  assert.equal(retired.length, 9);
  for (const file of retired) {
    const handlers = load(file, imports);
    for (const handler of Object.values(handlers)) {
      const response = await handler(new Request('https://example.test/?token=do-not-log'));
      assert.equal(response.status, 410, file);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(await response.text(), 'This admin panel has moved to Store Admin');
      assert.deepEqual(Object.keys(logs.at(-1)).sort(), ['route', 'status']);
      assert.equal(logs.at(-1).status, 410);
      assert.doesNotMatch(logs.at(-1).route, /token|do-not-log/);
    }
  }
  const proxy = readFileSync('src/proxy.ts', 'utf8');
  assert.doesNotMatch(proxy, /['"]admin_session['"]|pathname\.startsWith\(['"]\/api\/admin/);
});
