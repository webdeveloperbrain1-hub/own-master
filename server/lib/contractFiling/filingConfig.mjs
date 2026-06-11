import path from 'node:path';
import { loadEnv } from '../env.mjs';

loadEnv();

// Config for the ported contract-filing engine. Replaces the standalone app's
// config.mjs, but reads from the Own Masters .env (via loadEnv) instead of dotenv.
export const config = {
  databaseUrl: process.env.DATABASE_URL,
  storageDir: path.resolve(process.cwd(), process.env.CONTRACT_STORAGE_ROOT || 'storage', 'contract-filing'),
  contractZipPath: process.env.CONTRACT_ZIP_PATH || '',
  aiProvider: (process.env.AI_PROVIDER || 'ollama').toLowerCase(),
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
  ollamaModel: process.env.OLLAMA_MODEL || 'qwen2.5:7b-instruct',
};
