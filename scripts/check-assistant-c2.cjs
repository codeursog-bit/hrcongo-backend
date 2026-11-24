// Lance les cinq suites du chantier C2 (fournisseurs SIMULÉS, aucun appel réel, aucune base).
// Usage : node scripts/check-assistant-c2.cjs
const { spawnSync } = require('node:child_process');
const suites = ['privacy', 'plan', 'mask', 'transport', 'conversation', 'refs'];
let failed = 0;
for (const name of suites) {
  const file = `scripts/check-assistant-${name}.ts`;
  const r = spawnSync('npx', ['--yes', 'tsx', file], { encoding: 'utf8', shell: true });
  const last = (r.stdout || '').trim().split('\n').filter((l) => /^OK \d+ KO \d+/.test(l)).pop();
  const bad = r.status !== 0;
  if (bad) failed++;
  console.log(`${bad ? '✗' : '✓'} ${name.padEnd(13)} ${last || (r.stderr || '').trim().split('\n')[0]}`);
  if (bad && r.stdout) console.log(r.stdout.split('\n').filter((l) => l.startsWith('ECHEC')).join('\n'));
}
process.exit(failed ? 1 : 0);