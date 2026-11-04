import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createJiti } from 'jiti';
import { loopbackBase, transportCategory, checkMediaRoutes } from '../scripts/lib/compat-http-diagnostics.mjs';
import { compareSpecs } from '../scripts/lib/catalog-parity-report.mjs';

const jiti = createJiti(import.meta.url);
const { normaliseKey } = await jiti.import('../src/lib/storefront/catalog-rules.ts');

test('compat target requires an explicit credential-free loopback HTTP origin', () => {
  for (const value of [undefined, '', 'https://example.test', 'http://127.0.0.1.example.test', 'http://u:p@localhost', 'http://localhost/path', 'http://localhost?key=hidden', 'file:///tmp/a', 'https://localhost']) {
    assert.throws(() => loopbackBase(value));
  }
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    assert.equal(loopbackBase(`http://${host}:43188`).origin, `http://${host}:43188`);
  }
});

test('transport categorization reads bounded error codes, never sensitive messages', () => {
  const samples = [
    [{ cause: { errors: [{ code: 'ECONNREFUSED', message: 'private-token' }] } }, 'connection_refused'],
    [{ name: 'TimeoutError' }, 'timeout'],
    [{ cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }, 'timeout'],
    [{ code: 'ECONNRESET' }, 'connection_interrupted'],
    [{ code: 'ENOTFOUND' }, 'dns_failure'],
    [{ name: 'AbortError' }, 'aborted'],
    [{ message: 'private-token http://user:password@private.test' }, 'other_transport'],
  ];
  for (const [input, expected] of samples) assert.equal(transportCategory(input), expected);
  const cycle = {}; cycle.cause = cycle;
  assert.equal(transportCategory(cycle), 'other_transport');
});

test('media checks preserve manual redirects, cancel bodies and report each failure independently', async () => {
  let calls = 0; let cancels = 0;
  const result = await checkMediaRoutes(loopbackBase('http://127.0.0.1:43188'), ['/a', '/b', '/c', '/d', '/e'], async (url, options) => {
    assert.equal(url.origin, 'http://127.0.0.1:43188');
    assert.equal(options.redirect, 'manual');
    assert.ok(options.signal instanceof AbortSignal);
    calls++;
    if (calls === 4) throw { cause: { code: 'ECONNREFUSED' }, message: 'private-token' };
    return { status: [200, 302, 404, 0, 200][calls - 1], body: { cancel() { cancels++; if (calls === 5) throw Error('private-token'); } } };
  });
  assert.deepEqual(result, { attempted: 5, resolved: 3, httpFailures: { 404: 1 }, transportFailures: { connection_refused: 1 }, cancellationFailures: 1, ok: false });
  assert.equal(cancels, 4);
  assert.equal(JSON.stringify(result).includes('private-token'), false);
});

test('media check accepts only 200/302 and never hides cancellation errors behind resolution', async () => {
  for (const status of [200, 302, 301, 307, 401, 500]) {
    const result = await checkMediaRoutes(loopbackBase('http://localhost'), ['/a'], async () => ({ status }));
    assert.equal(result.ok, [200, 302].includes(status));
  }
});

test('known case specs share the real storefront key normalization without false missing/extra reports', () => {
  assert.deepEqual(compareSpecs([
    { label: 'material', value: 'TPU' }, { label: 'magneticHold', value: 'Strong' },
  ], [
    { label: 'Material', value: 'TPU' }, { label: 'Magnetic Hold', value: 'Strong' },
  ], normaliseKey), []);
});

test('spec report retains unequal values and collisions rather than selecting a winner', () => {
  const diff = compareSpecs([{ label: 'material', value: 'TPU' }], [{ label: 'Material', value: 'Leather' }], normaliseKey);
  assert.deepEqual(diff, [{ field: 'spec "material"', static: 'TPU', db: 'Leather' }]);
  const collision = compareSpecs([{ label: 'material', value: 'TPU' }], [
    { label: 'Material', value: 'TPU' }, { label: 'MATERIAL', value: 'TPU' },
  ], normaliseKey);
  assert.match(collision[0].field, /ambiguous label collision/);
  assert.equal(collision[0].db, '2 rows');
});

test('unknown spec labels stay literal; missing values never imply static filling', () => {
  const diff = compareSpecs([{ label: 'Cable Type', value: 'USB' }], [{ label: 'cabletype', value: 'USB' }], normaliseKey);
  assert.equal(diff.length, 2);
  assert.match(diff[0].db, /missing; no value assumed/);
});

test('diagnostic-only notification checks cannot send and do not invoke SMTP verification', async () => {
  const source = readFileSync(new URL('../scripts/check-notifications.mjs', import.meta.url), 'utf8');
  const flags = source.slice(source.indexOf('const offline ='), source.indexOf('const sendToIndex'));
  for (const flag of ['--offline', '--no-provider-probe']) {
    assert.throws(() => vm.runInNewContext(flags, { args: [flag, '--send-to'] }), /cannot send messages/);
  }
  const block = source.slice(source.indexOf('const setup = diagnostics.smtpSetupProblem'), source.indexOf('\nif (matrix)'));
  let probes = 0;
  const rows = [];
  await vm.runInNewContext(`(async () => {${block}})()`, {
    offline: false, noProviderProbe: true, settings: {},
    diagnostics: { smtpSetupProblem: () => null, checkMailConnection: () => { probes++; throw Error('Forbidden provider probe'); } },
    record: (...row) => rows.push(row),
  });
  assert.equal(probes, 0);
  assert.equal(rows[0][2], false);
  assert.match(rows[0][3], /skipped/);
});
