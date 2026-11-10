import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';

// Verification stays in the source project and never ships in a release.
const integration = new Set(['localAccounts.test.mjs', 'projectWorkspace.test.mjs', 'contractProgress.test.mjs', 'billing.test.mjs', 'guidePreview.test.mjs']);
const group = process.argv[2] || 'unit';
if (!['unit', 'integration'].includes(group)) throw new Error('Choose unit or integration.');
const files = (await readdir('tests')).filter(name => /\.test\.(mjs|tsx?)$/.test(name) && integration.has(name) === (group === 'integration')).sort();
const args = group === 'unit' ? ['--import', 'tsx', '--test'] : ['--test', '--test-concurrency=1'];
const child = spawn(process.execPath, [...args, ...files.map(name => `tests/${name}`)], { stdio: 'inherit' });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
