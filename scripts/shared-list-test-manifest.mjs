#!/usr/bin/env node
// Pure preflight only: never reads env files, imports postgres or probes a target.
import { sharedListManifest } from '../tests/helpers/shared-list-fixture.mjs';
try {
  if (process.argv.slice(2).some(arg => arg !== '--race')) throw new Error('Unsupported argument');
  const manifest = await sharedListManifest({ databaseUrl: process.env.SHARED_LIST_DATABASE_URL, race: process.argv.includes('--race'), ssl: process.env.SHARED_LIST_SSL ?? 'require' });
  console.log(JSON.stringify(manifest, null, 2));
} catch {
  console.error('Cannot generate shared-list manifest. Supply the explicit dedicated target and valid source files; no database connection was made.');
  process.exitCode = 1;
}
