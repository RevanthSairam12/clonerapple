// Pure evidence reconciliation: no environment loading, SQL client or connection.
import fs from 'node:fs';
import path from 'node:path';
import { completedSummary, registrationStatus } from './db-test-evidence.mjs';
const historical = '.tmp-phase4-tests-final.txt';
const directories = process.argv.slice(2);
if (!directories.length) throw new Error('Supply completed evidence directories');
const original = fs.readFileSync(historical, 'utf8').split(/\r?\n/)
  .filter(line => /^﹣ /.test(line))
  .map(line => line.replace(/^﹣ /, '').replace(/ \([\d.]+ms\) # .*$/, ''));
if (original.length !== 80 || new Set(original).size !== 80) throw new Error('Historical 80 registrations do not reconcile');
const paths = ['.tmp-phase2-approved-rerun.log', '.tmp-phase3-fixed-retry.log'].map(log => ({ log }));
for (const directory of directories) {
  const rows = JSON.parse(fs.readFileSync(path.join(directory, 'results.json'), 'utf8'));
  if (!Array.isArray(rows)) throw new Error('Evidence results must be an array');
  for (const row of rows) {
    if (typeof row.log !== 'string' || typeof row.file !== 'string') throw new Error('Invalid evidence row');
    paths.push(row);
  }
}
const outcomes = new Map();
const namesByFile = new Map();
for (const row of paths) {
  const file = row.log;
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  const key = row.file || file;
  const known = namesByFile.get(key) || new Set();
  // Source names let an interrupted latest rerun invalidate older evidence even
  // if it exited before printing any test marker. No test module is executed.
  if (row.file) {
    const source = fs.readFileSync(path.join('tests', `${row.file}.test.mjs`), 'utf8');
    for (const name of original) if (source.includes(name)) known.add(name);
  }
  const complete = completedSummary(text) && row.complete !== false && !row.signal && !row.errorCode;
  for (const name of original) {
    const status = registrationStatus(lines, name);
    if (status) known.add(name);
    if (status || known.has(name)) outcomes.set(name, {
      name, status: complete ? (status || 'not_run') : 'not_run', evidence: file,
    });
  }
  namesByFile.set(key, known);
}
const registrations = original.map(name => outcomes.get(name) ?? { name, status: 'not_run' });
const counts = registrations.reduce((result, row) => ({ ...result, [row.status]: result[row.status] + 1 }), { passed: 0, failed: 0, skipped: 0, not_run: 0 });
console.log(JSON.stringify({ historical, counts, registrations }, null, 2));
process.exitCode = counts.passed === 80 ? 0 : 1;
