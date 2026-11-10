import fs from 'node:fs/promises';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const source = fileURLToPath(new URL('../../', import.meta.url));
const assets = ['dist', 'server/apiServer.mjs', 'server/startProduction.mjs', 'server/startTrial.mjs', 'server/lib', 'server/assets',
  'prisma/schema.prisma', 'prisma/migrations', 'public/own-masters-logo.png',
  'scripts/checkDeployment.mjs', '.env.example', 'compose.production.yaml', 'ATTRIBUTIONS.md'];

async function runNpm(args, cwd) {
  let cli = process.env.npm_execpath;
  if (!cli && process.platform === 'win32') {
    cli = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
    await fs.access(cli);
  }
  const executable = cli ? process.execPath : 'npm';
  await new Promise((resolve, reject) => {
    const child = spawn(executable, cli ? [cli, ...args] : args, { cwd, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Runtime dependency lock failed (${code}).`)));
  });
}

export async function prepareRuntime(directory) {
  const output = path.resolve(directory);
  if (output === path.resolve(source) || output === path.parse(output).root) throw new Error('Choose a separate, empty runtime directory.');
  await fs.mkdir(output, { recursive: true });
  if ((await fs.readdir(output)).length) throw new Error('Runtime directory must be empty.');
  await fs.access(path.join(source, 'dist/index.html'));
  const sourcePackage = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'));
  const dependencies = new Set(['prisma']);
  async function copy(relative) {
    const from = path.join(source, relative), to = path.join(output, relative);
    const stat = await fs.lstat(from);
    if (stat.isSymbolicLink()) throw new Error(`Runtime cannot contain symbolic links: ${relative}`);
    if (stat.isDirectory()) {
      await fs.mkdir(to, { recursive: true });
      for (const child of (await fs.readdir(from)).sort()) await copy(path.join(relative, child));
    } else if (stat.isFile()) {
      if (/\.(?:log|test\.[^.]+)$/i.test(relative)) throw new Error(`Development file selected for release: ${relative}`);
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.copyFile(from, to);
      if (relative.endsWith('.mjs')) {
        const contents = await fs.readFile(from, 'utf8');
        for (const match of contents.matchAll(/(?:from\s*|import\s*\(|require\s*\()(['"])([^'"]+)\1/g)) {
          const specifier = match[2];
          if (specifier.startsWith('.') || specifier.startsWith('node:') || builtinModules.includes(specifier)) continue;
          const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
          if (!sourcePackage.dependencies[name]) throw new Error(`Runtime dependency is not declared: ${name}`);
          dependencies.add(name);
        }
      }
    }
  }
  for (const relative of assets) await copy(relative);
  for (const [from, to] of [['tools/release/README.md', 'README.md'], ['tools/release/Dockerfile', 'Dockerfile'], ['tools/release/dockerignore', '.dockerignore']]) {
    await fs.copyFile(path.join(source, from), path.join(output, to));
  }
  const runtimePackage = {
    name: sourcePackage.name, version: sourcePackage.version, private: true, type: 'module', engines: sourcePackage.engines,
    scripts: { postinstall: 'prisma generate', start: 'node server/startProduction.mjs', 'start:trial': 'node server/startTrial.mjs',
      'db:deploy': 'prisma migrate deploy', 'deploy:check': 'node scripts/checkDeployment.mjs' },
    dependencies: Object.fromEntries([...dependencies].sort().map(name => [name, sourcePackage.dependencies[name]])),
    overrides: sourcePackage.overrides,
  };
  await fs.writeFile(path.join(output, 'package.json'), `${JSON.stringify(runtimePackage, null, 2)}\n`);
  await fs.copyFile(path.join(source, 'package-lock.json'), path.join(output, 'package-lock.json'));
  await runNpm(['install', '--package-lock-only', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund'], output);
  const lock = JSON.parse(await fs.readFile(path.join(output, 'package-lock.json'), 'utf8'));
  if (lock.packages[''].devDependencies || lock.packages[''].peerDependencies) throw new Error('Development dependencies remained in the runtime lock.');
  const files = [];
  async function inventory(dir, relative = '') {
    for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, entry.name), name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await inventory(file, name);
      else files.push({ path: name, sha256: createHash('sha256').update(await fs.readFile(file)).digest('hex') });
    }
  }
  await inventory(output);
  await fs.writeFile(path.join(output, 'RELEASE-MANIFEST.json'), `${JSON.stringify({ name: sourcePackage.name, version: sourcePackage.version,
    generatedAt: new Date().toISOString(), files }, null, 2)}\n`);
  console.log(`Prepared production runtime: ${dependencies.size} direct server dependencies; ${files.length} application files.`);
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: node tools/release/prepareRuntime.mjs <empty-output-directory>');
  await prepareRuntime(process.argv[2]);
}
