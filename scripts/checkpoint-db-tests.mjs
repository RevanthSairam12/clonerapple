// Local documentation checkpoint only. No database client/environment loading.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const directories = process.argv.slice(2);
const result = spawnSync(process.execPath, ['--max-old-space-size=96', 'scripts/summarize-original-db-tests.mjs', ...directories], { encoding: 'utf8' });
if (result.error || result.signal || ![0, 1].includes(result.status)) throw new Error('Reconciliation did not complete');
const evidence = JSON.parse(result.stdout);
fs.writeFileSync('.tmp-original-80-current-results.json', result.stdout);
const { passed, failed, not_run, skipped } = evidence.counts;
let doc = fs.readFileSync('remaing tests.md', 'utf8');
doc = doc.replace(/\| Passed \| \*\*\d+\*\* \|/, `| Passed | **${passed}** |`)
  .replace(/\| Ran but failed \| \*\*\d+\*\* \|/, `| Ran but failed | **${failed}** |`)
  .replace(/\| No completed result \| \*\*\d+\*\* \|/, `| No completed result | **${not_run + skipped}** |`)
  .replace(/\| Still need to pass \| \*\*\d+\*\* \|/, `| Still need to pass | **${80 - passed}** |`)
  .replace(/\| \*\*Total\*\* \| \*\*\d+\*\* \| \*\*\d+\*\* \| \*\*\d+\*\* \|/, `| **Total** | **${passed}** | **${failed}** | **${not_run + skipped}** |`);
for (const directory of directories) {
  for (const row of JSON.parse(fs.readFileSync(`${directory}/results.json`, 'utf8'))) {
    const registrations = evidence.registrations.filter(r => r.evidence && r.evidence.replaceAll('\\', '/').endsWith(`/${row.file}.log`));
    if (!registrations.length) continue;
    const counts = s => registrations.filter(r => r.status === s).length;
    const line = `| \`${row.file}.test.mjs\` | ${counts('passed')} | ${counts('failed')} | ${counts('not_run') + counts('skipped')} |`;
    doc = doc.split('\n').map(old => old.startsWith(`| \`${row.file}.test.mjs\` |`) ? line : old).join('\n');
  }
}
const checkpoint = `## Latest execution checkpoint\n\nUpdated ${new Date().toISOString()}. Original registrations: **${passed} passed / ${failed} failed / ${not_run + skipped} incomplete**.\n\nOrdered completed evidence directories: ${directories.map(d => `\`${d}/results.json\``).join(', ')}. The exact-name index is \`.tmp-original-80-current-results.json\`. Earlier failure narratives below are historical unless the current index still marks that registration failed. Passing file reruns supersede their older failure logs; they do not complete the separate Phase 4 acceptance suite.\n\n`;
if (doc.includes('## Latest execution checkpoint')) doc = doc.replace(/## Latest execution checkpoint[\s\S]*?(?=## )/, checkpoint);
else doc = doc.replace('## Results by file', checkpoint + '## Results by file');
fs.writeFileSync('remaing tests.md', doc);
console.log(JSON.stringify(evidence.counts));
