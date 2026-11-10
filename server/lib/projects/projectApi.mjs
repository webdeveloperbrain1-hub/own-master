import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../prisma.mjs';

export const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
const includes = {
  comments: { orderBy: { createdAt: 'asc' } },
  contracts: { orderBy: { createdAt: 'desc' } },
};
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const audioRoot = () =>
  path.resolve(
    process.cwd(),
    process.env.CONTRACT_STORAGE_ROOT || './storage',
    'project-audio',
  );
const text = (value, label, limit, required = false) => {
  if (
    typeof value !== 'string' ||
    value.length > limit ||
    (required && !value.trim())
  ) {
    throw fail(
      `${label} ${required ? 'is required and ' : ''}must be at most ${limit.toLocaleString()} characters.`,
    );
  }
  return value.trim();
};

export function publicProject(project) {
  const { audioPath, userId, ...result } = project;
  return {
    ...result,
    hasAudio: Boolean(audioPath),
    audioVersion: audioPath ? path.basename(audioPath) : null,
  };
}

export async function ownedProject(db, userId, id, include) {
  const project = await db.musicProject.findFirst({
    where: { id, userId },
    ...(include ? { include } : {}),
  });
  if (!project) throw fail('Project not found.', 404);
  return project;
}

export function detectAudioType(bytes) {
  if (
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WAVE'
  )
    return 'audio/wav';
  if (bytes.toString('ascii', 0, 4) === 'fLaC') return 'audio/flac';
  if (bytes.toString('ascii', 0, 4) === 'OggS') return 'audio/ogg';
  if (bytes.toString('ascii', 4, 8) === 'ftyp') return 'audio/mp4';
  if (
    bytes.toString('ascii', 0, 3) === 'ID3' ||
    (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
  )
    return 'audio/mpeg';
  if (bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])))
    return 'audio/webm';
  throw fail(
    'Choose a supported audio file: MP3, WAV, M4A, FLAC, OGG, or WebM.',
  );
}

export function audioFilePath(storedPath) {
  const root = audioRoot();
  const resolved = path.resolve(storedPath);
  if (path.dirname(resolved) !== root) throw fail('Audio file not found.', 404);
  return resolved;
}

async function removeAudio(storedPath) {
  if (storedPath) await fs.rm(audioFilePath(storedPath), { force: true });
}

async function uploadAudio(req, project, fileName) {
  const name = text(fileName, 'Audio filename', 240, true);
  if (!/\.(mp3|wav|m4a|flac|ogg|webm)$/i.test(name))
    throw fail('Choose an MP3, WAV, M4A, FLAC, OGG, or WebM file.');
  if (Number(req.headers['content-length']) > MAX_AUDIO_BYTES)
    throw fail('Audio files must be 50 MB or smaller.', 413);
  const root = audioRoot();
  await fs.mkdir(root, { recursive: true });
  const target = path.join(root, randomUUID());
  const handle = await fs.open(target, 'wx');
  let size = 0;
  let head = Buffer.alloc(0);
  try {
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      size += chunk.length;
      if (size > MAX_AUDIO_BYTES)
        throw fail('Audio files must be 50 MB or smaller.', 413);
      if (head.length < 16) head = Buffer.concat([head, chunk]).subarray(0, 16);
      await handle.writeFile(chunk);
    }
    if (!size) throw fail('The audio file is empty.');
    const audioType = detectAudioType(head);
    await handle.close();
    const saved = await prisma.musicProject.update({
      where: { id: project.id, userId: project.userId },
      data: { audioPath: target, audioType, fileName: name, fileSize: size },
      include: includes,
    });
    // The database now points at the new upload; old-file cleanup must never
    // roll back or remove the successfully saved audio.
    await removeAudio(project.audioPath).catch((error) =>
      console.warn('[project-audio] cleanup:', error.message),
    );
    return saved;
  } catch (error) {
    req.resume();
    await handle.close().catch(() => {});
    await fs.rm(target, { force: true });
    throw error;
  }
}

async function streamAudio(req, res, project) {
  if (!project.audioPath)
    throw fail('No audio has been uploaded for this song.', 404);
  const file = audioFilePath(project.audioPath);
  const stat = await fs.stat(file).catch(() => {
    throw fail('Audio file not found. Please upload it again.', 404);
  });
  let start = 0;
  let end = stat.size - 1;
  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2]))
      throw fail('Invalid audio range.', 416);
    if (!match[1]) start = Math.max(0, stat.size - Number(match[2]));
    else {
      start = Number(match[1]);
      if (match[2]) end = Math.min(end, Number(match[2]));
    }
    if (start > end || start >= stat.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      res.end();
      return;
    }
  }
  res.writeHead(range ? 206 : 200, {
    'Content-Type': project.audioType,
    'Content-Length': end - start + 1,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin':
      process.env.CORS_ORIGIN || 'http://127.0.0.1:5174',
    ...(range ? { 'Content-Range': `bytes ${start}-${end}/${stat.size}` } : {}),
  });
  const stream = createReadStream(file, { start, end });
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

export async function handleProjectRoutes(
  req,
  res,
  { url, sendJson, readBody, requireAuth },
) {
  if (
    url.pathname !== '/api/projects' &&
    !url.pathname.startsWith('/api/projects/')
  )
    return false;
  const auth = await requireAuth(req);
  const userId = auth.user.id;
  const reply = (payload, status = 200) => {
    sendJson(res, status, payload);
    return true;
  };
  if (url.pathname === '/api/projects') {
    if (req.method === 'GET') {
      const projects = await prisma.musicProject.findMany({
        where: { userId },
        include: includes,
        orderBy: { updatedAt: 'desc' },
      });
      return reply(projects.map(publicProject));
    }
    if (req.method === 'POST') {
      const body = await readBody(req);
      const data = {
        userId,
        title: text(body.title, 'Song title', 160, true),
        lyrics: text(body.lyrics ?? '', 'Lyrics', 20000),
      };
      // Idempotent migration of browser-only track entries. Never remove the
      // original browser copy; legacy entries need the actual audio reuploaded.
      if (body.legacyId) {
        const legacyId = text(body.legacyId, 'Legacy ID', 100, true);
        data.legacyId = legacyId;
        data.comments = {
          create: (Array.isArray(body.comments) ? body.comments : [])
            .slice(0, 100)
            .map((comment) => ({
              body: text(comment.body, 'Note', 5000, true),
            })),
        };
        return reply(
          publicProject(
            await prisma.musicProject.upsert({
              where: { userId_legacyId: { userId, legacyId } },
              create: data,
              update: {},
              include: includes,
            }),
          ),
        );
      }
      return reply(
        publicProject(
          await prisma.musicProject.create({ data, include: includes }),
        ),
        201,
      );
    }
  }
  const match =
    /^\/api\/projects\/([^/]+)(?:\/(audio|update|delete|comments|contracts)(?:\/([^/]+))?)?$/.exec(
      url.pathname,
    );
  if (!match) return reply({ error: 'Project route not found.' }, 404);
  const [, id, action, linkId] = match;
  const project = await ownedProject(prisma, userId, id, includes);
  if (!action && req.method === 'GET') return reply(publicProject(project));
  if (action === 'audio' && req.method === 'GET') {
    await streamAudio(req, res, project);
    return true;
  }
  if (action === 'audio' && req.method === 'POST')
    return reply(
      publicProject(
        await uploadAudio(req, project, url.searchParams.get('name')),
      ),
    );
  if (action === 'update' && req.method === 'POST') {
    const body = await readBody(req);
    return reply(
      publicProject(
        await prisma.musicProject.update({
          where: { id, userId },
          data: {
            title: text(body.title, 'Song title', 160, true),
            lyrics: text(body.lyrics ?? '', 'Lyrics', 20000),
          },
          include: includes,
        }),
      ),
    );
  }
  if (action === 'delete' && req.method === 'POST') {
    await prisma.musicProject.delete({ where: { id, userId } });
    await removeAudio(project.audioPath).catch((error) =>
      console.warn('[project-audio] cleanup:', error.message),
    );
    return reply({ ok: true });
  }
  if (action === 'comments' && req.method === 'POST') {
    const body = await readBody(req);
    await prisma.musicProject.update({
      where: { id, userId },
      data: {
        comments: { create: { body: text(body.body, 'Note', 5000, true) } },
      },
    });
    return reply(
      publicProject(await ownedProject(prisma, userId, id, includes)),
    );
  }
  if (action === 'contracts' && req.method === 'POST') {
    if (linkId) {
      await prisma.projectContract.deleteMany({
        where: { id: linkId, projectId: id },
      });
    } else {
      const body = await readBody(req);
      const contractId = text(body.contractId, 'Contract ID', 100, true);
      let draftId = null,
        accountContractId = null,
        title,
        contractType;
      if (body.source === 'filing') {
        const draft = await prisma.contractDraft.findFirst({
          where: { id: contractId, userId },
          include: { template: true },
        });
        if (!draft) throw fail('Contract not found.', 404);
        draftId = draft.id;
        title = draft.name;
        contractType =
          draft.template.contractType || draft.template.title || 'Contract';
      } else if (body.source === 'account') {
        const data = await prisma.accountContract.findFirst({ where: { id: contractId, userId }, select: { id: true, title: true, contractType: true } });
        if (!data) throw fail('Contract not found.', 404);
        title = data.title;
        contractType = data.contractType;
        accountContractId = contractId;
      } else throw fail('Choose a supported contract source.');
      const key = draftId
        ? { projectId_draftId: { projectId: id, draftId } }
        : { projectId_accountContractId: { projectId: id, accountContractId } };
      await prisma.projectContract.upsert({
        where: key,
        create: {
          projectId: id,
          draftId,
          accountContractId,
          title,
          contractType,
        },
        update: { title, contractType },
      });
    }
    return reply(
      publicProject(await ownedProject(prisma, userId, id, includes)),
    );
  }
  return reply({ error: 'Project route not found.' }, 404);
}
