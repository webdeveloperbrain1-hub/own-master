import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';

export function contractStoragePaths() {
  const root = resolve(process.cwd(), process.env.CONTRACT_STORAGE_ROOT || './storage');

  return {
    root,
    zipDir: process.env.CONTRACT_ZIP_DIR ? resolve(process.env.CONTRACT_ZIP_DIR) : join(root, 'contract-zips'),
    templateDir: process.env.CONTRACT_TEMPLATE_DIR ? resolve(process.env.CONTRACT_TEMPLATE_DIR) : join(root, 'contract-templates'),
    generatedDir: process.env.GENERATED_CONTRACT_DIR ? resolve(process.env.GENERATED_CONTRACT_DIR) : join(root, 'generated-contracts'),
    tmpDir: process.env.TMP_DIR ? resolve(process.env.TMP_DIR) : join(root, 'tmp'),
  };
}

export async function ensureContractStorage() {
  const paths = contractStoragePaths();

  await Promise.all(
    Object.values(paths).map((dir) => mkdir(dir, { recursive: true })),
  );

  return paths;
}
