import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../prisma.mjs';
import { persistPrivateFile, ensurePrivateFile, removePrivateFile } from '../storage/privateFiles.mjs';

export const PROGRESS_STAGES = [
  'draft',
  'ready_for_review',
  'awaiting_signatures',
  'signed',
  'cancelled',
];
export const MAX_SIGNED_COPY_BYTES = 20 * 1024 * 1024;
const details = {
  events: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] },
  signedCopies: {
    orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }],
    select: { id: true, fileName: true, sizeBytes: true, uploadedAt: true },
  },
};
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const root = () =>
  path.resolve(
    process.cwd(),
    process.env.CONTRACT_STORAGE_ROOT || './storage',
    'signed-contracts',
  );
const reference = (source, contractId) =>
  source === 'filing'
    ? { draftId: contractId }
    : { accountContractId: contractId };

export async function requireProgressContract(auth, source, contractId) {
  if (source === 'filing') {
    const draft = await prisma.contractDraft.findFirst({
      where: { id: contractId, userId: auth.user.id },
      select: { id: true, status: true },
    });
    if (!draft) throw fail('Contract not found.', 404);
    return draft;
  }
  if (source !== 'account') throw fail('Contract not found.', 404);
  const data = await prisma.accountContract.findFirst({ where: { id: contractId, userId: auth.user.id }, select: { id: true, status: true } });
  if (!data) throw fail('Contract not found.', 404);
  return data;
}

function publicProgress(record, source, contractId, previousStatus) {
  if (!record)
    return {
      source,
      contractId,
      status: 'draft',
      tracked: false,
      version: 0,
      events: [],
      signedCopies: [],
      updatedAt: null,
      previousStatus,
    };
  const { userId, draftId, accountContractId, ...safe } = record;
  return { ...safe, source, contractId, tracked: true };
}

async function readProgress(userId, source, contractId, previousStatus) {
  const record = await prisma.contractProgress.findFirst({
    where: { userId, ...reference(source, contractId) },
    include: details,
  });
  return publicProgress(record, source, contractId, previousStatus);
}

function expectedVersion(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value >= 2147483647)
    throw fail('Reload contract progress and try again.');
  return value;
}

// The status and its audit event always commit together. A stale browser tab
// cannot overwrite a newer status or silently attach a copy to an old version.
async function writeProgress(
  auth,
  source,
  contractId,
  version,
  status,
  note,
  copy,
) {
  try {
    await prisma.$transaction(async (tx) => {
      const where = { userId: auth.user.id, ...reference(source, contractId) };
      let record = await tx.contractProgress.findFirst({ where });
      if (!record) record = await tx.contractProgress.create({ data: where });
      if (record.version !== version)
        throw fail(
          'This contract’s progress changed in another tab. Reload progress before trying again.',
          409,
        );
      if (
        status === 'signed' &&
        !copy &&
        !(await tx.signedContractCopy.count({
          where: { progressId: record.id },
        }))
      ) {
        throw fail('Upload a signed PDF before marking this contract signed.');
      }
      if (!copy && record.status === status && record.version > 0) return;
      const changed = await tx.contractProgress.updateMany({
        where: { id: record.id, userId: auth.user.id, version },
        data: { status, version: { increment: 1 } },
      });
      if (!changed.count)
        throw fail(
          'This contract’s progress changed in another tab. Reload progress before trying again.',
          409,
        );
      if (copy)
        await tx.signedContractCopy.create({
          data: { progressId: record.id, ...copy },
        });
      await tx.contractProgressEvent.create({
        data: {
          progressId: record.id,
          action: copy ? 'signed_copy_uploaded' : 'status_changed',
          fromStatus: record.version ? record.status : null,
          toStatus: status,
          actorId: auth.user.id,
          actorName: String(
            auth.user.user_metadata?.name || auth.user.email || 'Account owner',
          ).slice(0, 180),
          note: copy ? `Signed copy uploaded: ${copy.fileName}` : note,
        },
      });
    });
  } catch (error) {
    if (error.code === 'P2002')
      throw fail(
        'This contract’s progress changed in another tab. Reload progress before trying again.',
        409,
      );
    throw error;
  }
  return readProgress(auth.user.id, source, contractId);
}

export function signedCopyPath(filePath) {
  const resolved = path.resolve(filePath);
  if (path.dirname(resolved) !== root())
    throw fail('Signed copy not found.', 404);
  return resolved;
}

export async function cleanupSignedCopies(copies) {
  for (const copy of copies) {
    await removePrivateFile(signedCopyPath(copy.storedPath))
      .catch((error) => console.warn('[signed-copy] cleanup:', error.message));
  }
}

async function receiveSignedCopy(req, fileName) {
  if (
    typeof fileName !== 'string' ||
    !fileName.trim() ||
    fileName.length > 240 ||
    !/\.pdf$/i.test(fileName)
  )
    throw fail('Choose a signed PDF file.');
  if (Number(req.headers['content-length']) > MAX_SIGNED_COPY_BYTES)
    throw fail('Signed PDFs must be 20 MB or smaller.', 413);
  await fs.mkdir(root(), { recursive: true });
  const storedPath = path.join(root(), randomUUID());
  const handle = await fs.open(storedPath, 'wx');
  let sizeBytes = 0,
    head = Buffer.alloc(0);
  try {
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      sizeBytes += chunk.length;
      if (sizeBytes > MAX_SIGNED_COPY_BYTES)
        throw fail('Signed PDFs must be 20 MB or smaller.', 413);
      if (head.length < 5) head = Buffer.concat([head, chunk]).subarray(0, 5);
      await handle.writeFile(chunk);
    }
    if (head.toString('ascii') !== '%PDF-')
      throw fail('This file is not a PDF. Choose a signed PDF file.');
    await handle.close();
    await persistPrivateFile(storedPath);
    return {
      fileName: path.basename(fileName.replace(/\\/g, '/')),
      storedPath,
      sizeBytes,
    };
  } catch (error) {
    req.resume();
    await handle.close().catch(() => {});
    await removePrivateFile(storedPath).catch(() => fs.rm(storedPath, { force: true }));
    throw error;
  }
}

export async function handleContractProgressRoutes(
  req,
  res,
  { url, sendJson, readBody, requireAuth },
) {
  if (
    url.pathname !== '/api/contract-progress' &&
    !url.pathname.startsWith('/api/contract-progress/')
  )
    return false;
  const auth = await requireAuth(req);
  const userId = auth.user.id;
  if (url.pathname === '/api/contract-progress' && req.method === 'GET') {
    const records = await prisma.contractProgress.findMany({
      where: { userId },
      select: {
        draftId: true,
        accountContractId: true,
        status: true,
        updatedAt: true,
      },
    });
    sendJson(
      res,
      200,
      records.map(({ draftId, accountContractId, ...data }) => ({
        ...data,
        source: draftId ? 'filing' : 'account',
        contractId: draftId || accountContractId,
      })),
    );
    return true;
  }
  const match =
    /^\/api\/contract-progress\/(filing|account)\/([^/]+)(?:\/(status|signed-copies|cleanup)(?:\/([^/]+))?)?$/.exec(
      url.pathname,
    );
  if (!match) {
    sendJson(res, 404, { error: 'Contract progress not found.' });
    return true;
  }
  const [, source, contractId, action, copyId] = match;
  // Called after deleting a legacy browser contract; the progress
  // owner's identity remains independently verifiable even after deletion.
  if (source === 'account' && action === 'cleanup' && req.method === 'POST') {
    const record = await prisma.contractProgress.findFirst({
      where: { userId, accountContractId: contractId },
      include: { signedCopies: true },
    });
    if (record) {
      await prisma.contractProgress.delete({
        where: { id: record.id, userId },
      });
      await cleanupSignedCopies(record.signedCopies);
    }
    sendJson(res, 200, { ok: true });
    return true;
  }
  const contract = await requireProgressContract(auth, source, contractId);
  if (!action && req.method === 'GET') {
    sendJson(
      res,
      200,
      await readProgress(userId, source, contractId, contract.status),
    );
    return true;
  }
  if (action === 'status' && req.method === 'POST') {
    const body = await readBody(req);
    if (!PROGRESS_STAGES.includes(body.status))
      throw fail('Choose a valid contract stage.');
    if (
      body.note !== undefined &&
      (typeof body.note !== 'string' || body.note.length > 1000)
    )
      throw fail('Status notes must be 1,000 characters or fewer.');
    sendJson(
      res,
      200,
      await writeProgress(
        auth,
        source,
        contractId,
        expectedVersion(body.version),
        body.status,
        (body.note || '').trim(),
      ),
    );
    return true;
  }
  if (action === 'signed-copies' && !copyId && req.method === 'POST') {
    const version = expectedVersion(Number(url.searchParams.get('version')));
    const copy = await receiveSignedCopy(req, url.searchParams.get('name'));
    let result;
    try {
      result = await writeProgress(
        auth,
        source,
        contractId,
        version,
        'signed',
        '',
        copy,
      );
    } catch (error) {
      await cleanupSignedCopies([copy]);
      throw error;
    }
    sendJson(res, 200, result);
    return true;
  }
  if (action === 'signed-copies' && copyId && req.method === 'GET') {
    const copy = await prisma.signedContractCopy.findFirst({
      where: {
        id: copyId,
        progress: { userId, ...reference(source, contractId) },
      },
    });
    if (!copy) throw fail('Signed copy not found.', 404);
    const file = await ensurePrivateFile(signedCopyPath(copy.storedPath));
    await fs.access(file).catch(() => {
      throw fail(
        'The signed file is unavailable. Please check the server storage.',
        404,
      );
    });
    const safeName = copy.fileName.replace(/[^a-zA-Z0-9._ -]/g, '_');
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Length': copy.sizeBytes,
      'Content-Disposition': `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(copy.fileName)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Origin':
        process.env.CORS_ORIGIN || 'http://127.0.0.1:5174',
      'Access-Control-Expose-Headers': 'Content-Disposition, Content-Type',
    });
    const stream = createReadStream(file);
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
    return true;
  }
  sendJson(res, 404, { error: 'Contract progress not found.' });
  return true;
}
