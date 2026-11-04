// Sequential continuation of the explicitly authorized isolated SQL tests.
// Each file has a resource gate, read-only cleanup check and evidence checkpoint.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const [evidenceJson, ...files] = process.argv.slice(2);
const directories = JSON.parse(evidenceJson);
if (!Array.isArray(directories) || !files.length) throw new Error('Explicit evidence directories and files required');
const baseline = JSON.parse(fs.readFileSync('.tmp-db-resume-before-tests.json', 'utf8')).schemas;
function execute(script, args = []) {
  const result = spawnSync(process.execPath, ['--max-old-space-size=96', script, ...args], {
    encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=256' }, timeout: 0,
  });
  if (result.error || result.signal) throw new Error('Subprocess interrupted; stop for cleanup inspection');
  return result;
}
function inspect(file) {
  const result = execute('scripts/inspect-test-schemas.mjs');
  if (result.status !== 0) throw new Error('Read-only cleanup inspection failed');
  const report = JSON.parse(result.stdout);
  fs.writeFileSync(file, result.stdout, { flag: 'wx' });
  if (JSON.stringify(report.schemas) !== JSON.stringify(baseline)) throw new Error('Fixture schema baseline changed; no cleanup/adoption attempted');
}
function checkpoint() {
  const result = execute('scripts/checkpoint-db-tests.mjs', directories);
  if (result.status !== 0) throw new Error('Evidence checkpoint failed');
  console.log(result.stdout.trim());
}
try {
  for (const file of files) {
    const resource = spawnSync('powershell.exe', ['-NoProfile', '-Command', '$os = Get-CimInstance Win32_OperatingSystem; [math]::Round($os.FreePhysicalMemory/1024)'], { encoding: 'utf8' });
    const free = Number(resource.stdout.trim());
    if (resource.status !== 0 || !Number.isFinite(free) || free < 1536) throw new Error('Insufficient memory; next file not started');
    console.log(`Starting ${file}; free memory ${free} MB`);
    const before = `.tmp-db-before-${file}-${Date.now()}.json`;
    inspect(before);
    const run = execute('scripts/run-approved-legacy-tests.mjs', [file]);
    const directory = run.stdout.match(/Evidence directory: (\S+)/)?.[1];
    // Print only the runner's safe metadata, never raw SQL exceptions/env values.
    console.log(run.stdout.trim());
    if (!directory || !fs.existsSync(`${directory}/results.json`)) throw new Error('Missing completed result; stop for inspection');
    directories.push(directory);
    checkpoint();
    inspect(`${directory}/cleanup.json`);
    if (run.status !== 0) throw new Error(`Test file ${file} failed; later files not started`);
  }
  console.log('All selected files completed with verified cleanup.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
