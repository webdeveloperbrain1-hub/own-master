import fs from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { prepareRuntime } from './prepareRuntime.mjs';

async function rename(from, to) {
  // Some Windows workspaces deny directory renames. Preserve a full copy first
  // and remove only a verified generated release path in that case.
  if (process.platform === 'win32' && (await fs.lstat(from)).isDirectory()) {
    const base = path.basename(from);
    if (path.dirname(from) !== releases || (base !== 'own-masters' && !base.startsWith('.own-masters-'))
      || !to.startsWith(`${releases}${path.sep}`)) throw new Error('Invalid generated release move.');
    await fs.cp(from, to, { recursive: true, errorOnExist: true, force: false });
    console.log(`Removing copied generated release directory within ${releases}: ${from}`);
    await fs.rm(from, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    return;
  }
  for (let attempt = 0; ; attempt++) {
    try { await fs.rename(from, to); return; }
    catch (error) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt === 9) throw error;
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
}

const releases = path.resolve('releases');
await fs.mkdir(releases, { recursive: true });
const staging = await fs.mkdtemp(path.join(releases, '.own-masters-'));
await prepareRuntime(staging);
const archive = new AdmZip();
async function add(directory, relative = '') {
  for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Release cannot contain symbolic links: ${name}`);
    if (entry.isDirectory()) await add(file, name);
    else archive.addFile(`own-masters/${name}`, await fs.readFile(file));
  }
}
await add(staging);
const folder = path.join(releases, 'own-masters');
const zip = path.join(releases, 'own-masters.zip');
// Preserve previous handoffs, including any settings someone added to them.
const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
for (const file of [folder, zip]) {
  try { await fs.access(file); } catch { continue; }
  const destination = path.join(releases, 'archive', `${path.basename(file)}-${stamp}`);
  if (path.dirname(file) !== releases || !destination.startsWith(`${releases}${path.sep}archive${path.sep}`)) throw new Error('Invalid release archive path.');
  await fs.mkdir(path.dirname(destination), { recursive: true });
  console.log(`Preserving previous release: ${file} -> ${destination}`);
  await rename(file, destination);
}
await rename(staging, folder);
archive.writeZip(zip);
console.log(`Created ${folder}`);
console.log(`Created ${zip} (${archive.getEntries().length} files). Tests, previews, credentials and user data are excluded.`);
