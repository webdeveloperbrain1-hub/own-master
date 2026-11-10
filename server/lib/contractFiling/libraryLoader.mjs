import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { config } from './filingConfig.mjs';
import { importZip } from './importer.mjs';

const bundledLibrary = fileURLToPath(new URL('../../assets/contract-library.zip', import.meta.url));

async function findLibraryArchive() {
  for (const candidate of [config.contractZipPath, bundledLibrary].filter(Boolean)) {
    if (await fs.stat(candidate).then((stat) => stat.isFile(), () => false)) return candidate;
  }
  throw new Error('The bundled contract library archive is missing.');
}

export function createLibraryLoader({ findArchive = findLibraryArchive, importArchive = importZip } = {}) {
  let loading;
  return function ensureLibrary() {
    if (!loading) {
      loading = (async () => {
        const archive = await findArchive();
        // Keep first-run loading independent of AI credentials and services.
        // The importer skips existing content hashes and preserves draft IDs.
        const result = await importArchive(archive, { analyze: 'local' });
        if (result.failed) throw new Error(`Could not load ${result.failed} contract library file(s).`);
        return result;
      })().catch((error) => {
        loading = undefined;
        throw error;
      });
    }
    return loading;
  };
}

export const ensureContractLibrary = createLibraryLoader();
