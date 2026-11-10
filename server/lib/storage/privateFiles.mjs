import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const unavailable = () => Object.assign(new Error('Private file storage is unavailable. Please try again.'), { status: 503 });

export function privateFileConfiguration(env = process.env) {
  const backend = env.FILE_STORAGE_BACKEND || 'filesystem';
  const root = path.resolve(env.CONTRACT_STORAGE_ROOT || './storage');
  if (backend === 'filesystem') return { backend, root };
  if (backend !== 'supabase') throw new Error('FILE_STORAGE_BACKEND must be filesystem or supabase.');
  let origin;
  try {
    const url = new URL(env.SUPABASE_URL);
    if (url.protocol !== 'https:' || url.origin !== env.SUPABASE_URL ||
      !url.hostname.endsWith('.supabase.co')) throw new Error();
    origin = url.origin;
  } catch { throw new Error('Set SUPABASE_URL to the project HTTPS origin for private file storage.'); }
  const key = env.SUPABASE_STORAGE_KEY || '';
  let role;
  try { role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role; } catch { /* New secret keys are not JWTs. */ }
  if (!(key.startsWith('sb_secret_') || role === 'service_role'))
    throw new Error('Set the server-only SUPABASE_STORAGE_KEY to a Supabase secret/service-role key. An anon key cannot store private files.');
  const bucket = env.SUPABASE_STORAGE_BUCKET || 'own-masters-private';
  if (!/^[a-z0-9][a-z0-9._-]{1,62}$/.test(bucket)) throw new Error('Set a valid SUPABASE_STORAGE_BUCKET name.');
  return { backend, root, origin, key, bucket };
}

export function createPrivateFileStore({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const config = privateFileConfiguration(env);
  const downloads = new Map();
  let verified;
  const headers = config.backend === 'supabase' ? { apikey: config.key, Authorization: `Bearer ${config.key}` } : {};
  const objectKey = (file) => {
    const relative = path.relative(config.root, path.resolve(file));
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
      throw new Error('Private files must remain inside CONTRACT_STORAGE_ROOT.');
    return relative.split(path.sep).map(encodeURIComponent).join('/');
  };
  const request = async (route, options = {}) => {
    try {
      const response = await fetchImpl(`${config.origin}/storage/v1/${route}`, {
        redirect: 'error', ...options,
        headers: { ...headers, ...options.headers },
        signal: AbortSignal.timeout(90000),
      });
      if (!response.ok) throw unavailable();
      return response;
    } catch { throw unavailable(); }
  };
  async function verify() {
    if (config.backend === 'filesystem') return;
    if (!verified) verified = (async () => {
      const response = await request(`bucket/${encodeURIComponent(config.bucket)}`);
      const bucket = await response.json();
      if (bucket.public !== false) throw new Error('The Supabase file bucket must be private.');
    })().catch(error => { verified = undefined; throw error; });
    await verified;
  }
  async function persist(file) {
    if (config.backend === 'filesystem') return;
    const key = objectKey(file);
    await verify();
    const stat = await fs.stat(file);
    const input = createReadStream(file);
    try {
      await request(`object/${encodeURIComponent(config.bucket)}/${key}`, {
        method: 'POST', body: input, duplex: 'half',
        headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(stat.size), 'x-upsert': 'true' },
      });
    } finally { input.destroy(); }
  }
  async function restore(file) {
    const key = objectKey(file);
    await verify();
    const response = await request(`object/authenticated/${encodeURIComponent(config.bucket)}/${key}`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.download-${randomUUID()}`;
    try {
      await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary, { flags: 'wx' }));
      await fs.rename(temporary, file);
    } finally { await fs.rm(temporary, { force: true }); }
    return file;
  }
  async function ensure(file) {
    const resolved = path.resolve(file);
    if (await fs.stat(resolved).then(stat => stat.isFile(), () => false)) return resolved;
    if (config.backend === 'filesystem') { await fs.access(resolved); return resolved; }
    if (!downloads.has(resolved)) downloads.set(resolved, restore(resolved).finally(() => downloads.delete(resolved)));
    return downloads.get(resolved);
  }
  async function remove(file) {
    if (!file) return;
    if (config.backend === 'supabase') {
      const key = decodeURIComponent(objectKey(file));
      await verify();
      await request(`object/${encodeURIComponent(config.bucket)}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [key] }),
      });
    }
    await fs.rm(file, { force: true });
  }
  return { verify, persist, ensure, remove };
}

let active, signature;
function store() {
  const next = JSON.stringify(privateFileConfiguration());
  if (next !== signature) { active = createPrivateFileStore(); signature = next; }
  return active;
}
export const verifyPrivateStorage = () => store().verify();
export const persistPrivateFile = file => store().persist(file);
export const ensurePrivateFile = file => store().ensure(file);
export const removePrivateFile = file => store().remove(file);
