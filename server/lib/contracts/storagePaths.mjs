import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

export function contractStoragePaths() {
  const root = resolve(process.cwd(), process.env.CONTRACT_STORAGE_ROOT || './storage');

  return {
    root,
    zipDir: resolve(process.cwd(), process.env.CONTRACT_ZIP_DIR || './storage/contract-zips'),
    templateDir: resolve(process.cwd(), process.env.CONTRACT_TEMPLATE_DIR || './storage/contract-templates'),
    generatedDir: resolve(process.cwd(), process.env.GENERATED_CONTRACT_DIR || './storage/generated-contracts'),
    tmpDir: resolve(process.cwd(), process.env.TMP_DIR || './storage/tmp'),
  };
}

export async function ensureContractStorage() {
  const paths = contractStoragePaths();

  await Promise.all(
    Object.values(paths).map((dir) => mkdir(dir, { recursive: true })),
  );

  return paths;
}
