import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { prisma } from '../server/lib/prisma.mjs';
import {
  handleProjectRoutes,
  MAX_AUDIO_BYTES,
} from '../server/lib/projects/projectApi.mjs';
import { handleFilingRoutes } from '../server/lib/contractFiling/filingApi.mjs';

// Exercise the actual HTTP handlers and database, with isolated owners and
// fixtures. Authentication is injected only into this loopback test server.
test('song workspace persists audio and contracts and isolates two owners', async () => {
  const owner = `workspace-test-${randomUUID()}`;
  const other = `workspace-test-${randomUUID()}`;
  const createdFiles = [];
  let template;
  const server = createServer(async (req, res) => {
    const sendJson = (response, status, data) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(data));
    };
    const ctx = {
      url: new URL(req.url, 'http://localhost'),
      sendJson,
      requireAuth: async () => {
        const userId = req.headers['x-test-owner'];
        if (![owner, other].includes(userId))
          throw Object.assign(new Error('Authentication required.'), {
            status: 401,
          });
        return { user: { id: userId }, isDemo: false };
      },
      readBody: async (request) => {
        let body = '';
        for await (const chunk of request) body += chunk;
        return JSON.parse(body || '{}');
      },
    };
    try {
      if (await handleProjectRoutes(req, res, ctx)) return;
      if (await handleFilingRoutes(req, res, ctx)) return;
      sendJson(res, 404, {});
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (route, body, user = owner) =>
    fetch(`${base}${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'X-Test-Owner': user, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const json = async (response, status = 200) => {
    const payload = await response.json();
    assert.equal(response.status, status, JSON.stringify(payload));
    return payload;
  };
  try {
    assert.equal((await fetch(`${base}/api/projects`)).status, 401);
    assert.equal((await fetch(`${base}/api/filing/drafts`)).status, 401);
    await json(await call('/api/projects', { title: ' ', lyrics: '' }), 400);
    const project = await json(
      await call('/api/projects', {
        title: 'Test song',
        lyrics: 'A saved lyric',
      }),
      201,
    );
    assert.equal(project.hasAudio, false);
    assert.equal('audioPath' in project, false);
    assert.equal('userId' in project, false);
    const route = `/api/projects/${project.id}`;
    assert.equal((await call(route, undefined, other)).status, 404);
    assert.equal(
      (await call(`${route}/update`, { title: 'Stolen', lyrics: '' }, other))
        .status,
      404,
    );
    assert.equal((await call(`${route}/delete`, {}, other)).status, 404);
    assert.equal(
      (await call(`${route}/comments`, { body: 'No' }, other)).status,
      404,
    );
    assert.equal((await call(`${route}/audio`, undefined, other)).status, 404);
    assert.equal((await call(`${route}/audio`, undefined)).status, 404);
    const wav = Buffer.alloc(8044);
    wav.write('RIFF');
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8000, 24);
    wav.writeUInt32LE(16000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36);
    wav.writeUInt32LE(wav.length - 44, 40);
    const upload = (data, name = 'song.wav', user = owner) =>
      fetch(`${base}${route}/audio?name=${name}`, {
        method: 'POST',
        headers: { 'X-Test-Owner': user, 'Content-Type': 'audio/wav' },
        body: data,
      });
    assert.equal((await upload(wav, 'song.wav', other)).status, 404);
    assert.equal(
      (await upload(Buffer.from('<script>bad</script>'))).status,
      400,
    );
    assert.equal((await upload(wav, 'song.txt')).status, 400);
    assert.equal((await upload(Buffer.alloc(MAX_AUDIO_BYTES + 1))).status, 413);
    const withAudio = await json(await upload(wav));
    assert.equal(withAudio.hasAudio, true);
    assert.equal(withAudio.fileSize, wav.length);
    assert.equal('audioPath' in withAudio, false);
    createdFiles.push(
      (await prisma.musicProject.findUnique({ where: { id: project.id } }))
        .audioPath,
    );
    const audio = await call(`${route}/audio`);
    assert.equal(audio.headers.get('Content-Type'), 'audio/wav');
    assert.deepEqual(Buffer.from(await audio.arrayBuffer()), wav);
    const range = await fetch(`${base}${route}/audio`, {
      headers: { 'X-Test-Owner': owner, Range: 'bytes=0-11' },
    });
    assert.equal(range.status, 206);
    assert.deepEqual(
      Buffer.from(await range.arrayBuffer()),
      wav.subarray(0, 12),
    );
    const updated = await json(
      await call(`${route}/update`, {
        title: 'Renamed song',
        lyrics: 'Edited lyrics',
      }),
    );
    assert.equal(updated.title, 'Renamed song');
    assert.equal(updated.lyrics, 'Edited lyrics');
    assert.equal(
      (
        await json(
          await call(`${route}/comments`, { body: 'Raise the chorus vocal' }),
        )
      ).comments.length,
      1,
    );
    const nextAudio = await json(await upload(wav, 'new.wav'));
    const nextPath = (
      await prisma.musicProject.findUnique({ where: { id: project.id } })
    ).audioPath;
    createdFiles.push(nextPath);
    assert.notEqual(nextAudio.audioVersion, withAudio.audioVersion);
    await assert.rejects(fs.stat(createdFiles[0]), { code: 'ENOENT' });

    template = await prisma.contractFile.create({
      data: {
        originalName: 'Test agreement.txt',
        originalPath: 'test',
        storedPath: 'test',
        extension: '.txt',
        sizeBytes: 40,
        sha256: randomUUID(),
        extractedText: 'Song agreement ______',
        title: 'Test agreement',
        contractType: 'Test agreement',
      },
    });
    // Template search must match visible metadata, rather than returning
    // unrelated agreements that mention a producer inside their body text.
    const searchKey = `search-fixture-${randomUUID()}`;
    await prisma.contractFile.update({ where: { id: template.id }, data: {
      category: searchKey, extractedText: 'A producer receives royalties under this agreement.',
    } });
    const search = (query) => call(`/api/filing/templates?q=${encodeURIComponent(query)}`);
    assert.deepEqual(await json(await search(`${searchKey} produ`)), []);
    await prisma.contractFile.update({ where: { id: template.id }, data: { title: 'Producer Royalty Agreement' } });
    assert.deepEqual((await json(await search(`  ${searchKey}   pRoDu  `))).map((item) => item.id), [template.id]);
    assert.deepEqual((await json(await search(`${searchKey} royalty producer`))).map((item) => item.id), [template.id]);
    assert.deepEqual(await json(await search(`${searchKey} no-such-template`)), []);
    assert.ok((await json(await search(''))).some((item) => item.id === template.id));
    const draft = await json(
      await call(`/api/filing/templates/${template.id}/drafts`, {
        name: 'Song agreement',
        renderedText: 'My song agreement',
        projectId: project.id,
      }),
    );
    assert.equal(draft.draft.userId, owner);
    let linked = await json(await call(route));
    assert.equal(linked.contracts.length, 1);
    assert.equal(linked.contracts[0].draftId, draft.draft.id);
    assert.equal(
      (await json(await call('/api/filing/drafts', undefined, other))).some(
        (item) => item.id === draft.draft.id,
      ),
      false,
    );
    assert.equal(
      (await call(`/api/filing/drafts/${draft.draft.id}`, undefined, other))
        .status,
      404,
    );
    assert.equal(
      (
        await call(
          `/api/filing/drafts/${draft.draft.id}/download`,
          undefined,
          other,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await call(
          `/api/filing/drafts/${draft.draft.id}/update`,
          { renderedText: 'stolen' },
          other,
        )
      ).status,
      404,
    );
    await json(
      await call(`/api/filing/drafts/${draft.draft.id}/delete`, {}, other),
    );
    assert.ok(
      await prisma.contractDraft.findUnique({ where: { id: draft.draft.id } }),
    );
    assert.equal(
      (
        await call(
          `/api/projects/${project.id}/contracts`,
          { source: 'filing', contractId: draft.draft.id },
          other,
        )
      ).status,
      404,
    );
    const otherProject = await json(
      await call('/api/projects', { title: 'Other song' }, other),
      201,
    );
    assert.equal(
      (
        await call(
          `/api/projects/${otherProject.id}/contracts`,
          { source: 'filing', contractId: draft.draft.id },
          other,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await call(
          `/api/filing/templates/${template.id}/drafts`,
          { renderedText: 'wrong project', projectId: project.id },
          other,
        )
      ).status,
      404,
    );
    await json(
      await call(`/api/filing/drafts/${draft.draft.id}/update`, {
        name: 'Renamed agreement',
        renderedText: 'Edited agreement',
        projectId: project.id,
      }),
    );
    linked = await json(await call(route));
    assert.equal(linked.contracts.length, 1);
    assert.equal(linked.contracts[0].title, 'Renamed agreement');
    const pdf = await call(
      `/api/filing/drafts/${draft.draft.id}/download?format=pdf`,
    );
    assert.equal(pdf.status, 200);
    assert.match(
      Buffer.from(await pdf.arrayBuffer()).toString('ascii', 0, 5),
      /%PDF/,
    );
    await json(await call(`${route}/contracts/${linked.contracts[0].id}`, {}));
    assert.equal((await json(await call(route))).contracts.length, 0);
    assert.ok(
      await prisma.contractDraft.findUnique({ where: { id: draft.draft.id } }),
    );
    await json(
      await call(`${route}/contracts`, {
        source: 'filing',
        contractId: draft.draft.id,
      }),
    );
    await json(
      await call(`${route}/contracts`, {
        source: 'filing',
        contractId: draft.draft.id,
      }),
    );
    assert.equal((await json(await call(route))).contracts.length, 1);
    await json(await call(`${route}/delete`, {}));
    await assert.rejects(fs.stat(nextPath), { code: 'ENOENT' });
    assert.ok(
      await prisma.contractDraft.findUnique({ where: { id: draft.draft.id } }),
    );

    const legacy = {
      legacyId: randomUUID(),
      title: 'Browser song',
      lyrics: 'Original lyric',
      comments: [{ body: 'Original note' }],
    };
    const migrated = await json(await call('/api/projects', legacy));
    const again = await json(await call('/api/projects', legacy));
    assert.equal(migrated.id, again.id);
    assert.equal(again.comments.length, 1);
    assert.equal(again.hasAudio, false);
  } finally {
    await prisma.musicProject.deleteMany({
      where: { userId: { in: [owner, other] } },
    });
    if (template) {
      await prisma.contractDraft.deleteMany({
        where: { templateId: template.id },
      });
      await prisma.contractFile.delete({ where: { id: template.id } });
    }
    for (const file of createdFiles) await fs.rm(file, { force: true });
    await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect();
  }
});
