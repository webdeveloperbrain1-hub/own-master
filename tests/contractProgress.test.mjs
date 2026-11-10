import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import PDFDocument from 'pdfkit';
import { prisma } from '../server/lib/prisma.mjs';
import {
  cleanupSignedCopies,
  handleContractProgressRoutes,
  MAX_SIGNED_COPY_BYTES,
} from '../server/lib/contracts/contractProgress.mjs';
import { handleFilingRoutes } from '../server/lib/contractFiling/filingApi.mjs';

test('manual contract stages, history and signed PDFs persist with owner and concurrency checks', async () => {
  const owner = `progress-test-${randomUUID()}`,
    other = `progress-test-${randomUUID()}`;
  const accountId = randomUUID();
  let template;
  const server = createServer(async (req, res) => {
    const ctx = {
      url: new URL(req.url, 'http://localhost'),
      sendJson(response, status, payload) {
        response.writeHead(status, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(payload));
      },
      async readBody(request) {
        let body = '';
        for await (const chunk of request) body += chunk;
        return JSON.parse(body || '{}');
      },
      async requireAuth(request) {
        const id = request.headers['x-test-owner'];
        if (![owner, other].includes(id))
          throw Object.assign(new Error('Authentication required.'), {
            status: 401,
          });
        return {
          user: {
            id,
            user_metadata: {
              name: id === owner ? 'Test owner' : 'Other owner',
            },
          },
        };
      },
    };
    try {
      if (await handleContractProgressRoutes(req, res, ctx)) return;
      if (await handleFilingRoutes(req, res, ctx)) return;
      ctx.sendJson(res, 404, {});
    } catch (error) {
      ctx.sendJson(res, error.status || 500, { error: error.message });
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (route, body, user = owner) =>
    fetch(base + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'X-Test-Owner': user, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const json = async (response, status = 200) => {
    const body = await response.json();
    assert.equal(response.status, status, JSON.stringify(body));
    return body;
  };
  try {
    await prisma.accountUser.create({
      data: {
        id: owner,
        email: `${owner}@example.test`,
        name: 'Progress owner',
        passwordHash: 'unused-test-hash',
      },
    });
    await prisma.accountContract.create({
      data: {
        id: accountId,
        userId: owner,
        title: 'Progress fixture',
        contractType: 'Test',
        content: 'Test agreement',
      },
    });
    template = await prisma.contractFile.create({
      data: {
        originalName: 'Progress fixture.txt',
        originalPath: 'test',
        storedPath: 'test',
        extension: '.txt',
        sizeBytes: 20,
        sha256: randomUUID(),
        title: 'Test agreement',
        extractedText: 'Test agreement',
      },
    });
    const draft = await prisma.contractDraft.create({
      data: {
        userId: owner,
        templateId: template.id,
        name: 'Progress fixture',
        values: {},
        renderedText: 'Original draft text',
      },
    });
    const route = `/api/contract-progress/filing/${draft.id}`;
    assert.equal((await fetch(base + '/api/contract-progress')).status, 401);
    const initial = await json(await call(route));
    assert.equal(initial.status, 'draft');
    assert.equal(initial.tracked, false);
    assert.equal(initial.events.length, 0);
    assert.equal(
      await prisma.contractProgress.count({ where: { userId: owner } }),
      0,
      'reading does not create progress',
    );
    assert.equal((await call(route, undefined, other)).status, 404);
    await json(
      await call(`${route}/status`, { status: 'invented', version: 0 }),
      400,
    );
    await json(
      await call(`${route}/status`, { status: 'signed', version: 0 }),
      400,
    );
    assert.equal(
      await prisma.contractProgress.count({ where: { userId: owner } }),
      0,
      'a rejected status does not create partial history',
    );
    const ready = await json(
      await call(`${route}/status`, {
        status: 'ready_for_review',
        version: 0,
        note: 'Ready for the producer to review',
      }),
    );
    assert.equal(ready.status, 'ready_for_review');
    assert.equal(ready.version, 1);
    assert.equal(ready.events.length, 1);
    assert.equal(ready.events[0].actorName, 'Test owner');
    assert.equal(ready.events[0].note, 'Ready for the producer to review');
    const duplicate = await json(
      await call(`${route}/status`, { status: 'ready_for_review', version: 1 }),
    );
    assert.equal(duplicate.version, 1);
    assert.equal(duplicate.events.length, 1);
    await json(
      await call(`${route}/status`, {
        status: 'awaiting_signatures',
        version: 0,
      }),
      409,
    );
    await json(
      await call(`${route}/status`, { status: 'cancelled', version: 1 }, other),
      404,
    );
    const awaiting = await json(
      await call(`${route}/status`, {
        status: 'awaiting_signatures',
        version: 1,
      }),
    );
    assert.equal(awaiting.events[0].fromStatus, 'ready_for_review');
    assert.equal(awaiting.version, 2);
    await json(
      await call(`${route}/status`, {
        status: 'draft',
        version: 2,
        note: 'x'.repeat(1001),
      }),
      400,
    );

    const pdf = new PDFDocument();
    const chunks = [];
    const pdfBuffer = new Promise((resolve) => {
      pdf.on('data', (chunk) => chunks.push(chunk));
      pdf.on('end', () => resolve(Buffer.concat(chunks)));
    });
    pdf.text('TEST FIXTURE ONLY — uploaded copy, no real signature.');
    pdf.end();
    const bytes = await pdfBuffer;
    const upload = (
      data,
      version,
      name = 'signed-test.pdf',
      user = owner,
      endpoint = route,
    ) =>
      fetch(
        `${base}${endpoint}/signed-copies?name=${encodeURIComponent(name)}&version=${version}`,
        {
          method: 'POST',
          headers: { 'X-Test-Owner': user, 'Content-Type': 'application/pdf' },
          body: data,
        },
      );
    await json(await upload(Buffer.from('not a PDF'), 2), 400);
    await json(await upload(bytes, 2, 'test.exe'), 400);
    await json(await upload(Buffer.alloc(MAX_SIGNED_COPY_BYTES + 1), 2), 413);
    await json(await upload(bytes, 2, 'test.pdf', other), 404);
    const signed = await json(await upload(bytes, 2));
    assert.equal(signed.status, 'signed');
    assert.equal(signed.version, 3);
    assert.equal(signed.signedCopies.length, 1);
    assert.equal(signed.events[0].action, 'signed_copy_uploaded');
    assert.equal(signed.events[0].fromStatus, 'awaiting_signatures');
    assert.equal(JSON.stringify(signed).includes('storedPath'), false);
    const downloadPath = `${route}/signed-copies/${signed.signedCopies[0].id}`;
    const download = await call(downloadPath);
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('Cache-Control'), 'private, no-store');
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
    assert.equal((await call(downloadPath, undefined, other)).status, 404);
    assert.equal((await call(`${route}/signed-copies/not-a-copy`)).status, 404);
    await json(await upload(bytes, 1), 409);
    const second = await json(await upload(bytes, 3, 'signed-final.pdf'));
    assert.equal(second.signedCopies.length, 2);
    assert.equal(second.version, 4);
    await json(
      await call(`/api/filing/drafts/${draft.id}/update`, {
        name: 'Edited working draft',
        renderedText: 'Edited after upload',
      }),
    );
    const afterEdit = await json(await call(route));
    assert.equal(afterEdit.status, 'signed');
    assert.equal(afterEdit.version, 4);
    assert.equal(afterEdit.signedCopies.length, 2);
    const originalCopy = await call(downloadPath);
    assert.deepEqual(Buffer.from(await originalCopy.arrayBuffer()), bytes);
    const cancelled = await json(
      await call(`${route}/status`, {
        status: 'cancelled',
        version: 4,
        note: 'No longer proceeding',
      }),
    );
    assert.equal(cancelled.signedCopies.length, 2);
    assert.equal(cancelled.status, 'cancelled');
    const summaries = await json(await call('/api/contract-progress'));
    assert.equal(
      summaries.find((item) => item.contractId === draft.id).status,
      'cancelled',
    );
    assert.deepEqual(
      await json(await call('/api/contract-progress', undefined, other)),
      [],
    );

    const accountRoute = `/api/contract-progress/account/${accountId}`;
    await json(
      await call(`${accountRoute}/status`, {
        status: 'ready_for_review',
        version: 0,
      }),
    );
    assert.equal((await call(accountRoute, undefined, other)).status, 404);
    const accountSigned = await json(
      await upload(bytes, 1, 'account-signed.pdf', owner, accountRoute),
    );
    assert.equal(accountSigned.status, 'signed');
    const accountCopy = await prisma.signedContractCopy.findFirst({
      where: { progress: { userId: owner, accountContractId: accountId } },
    });
    await prisma.accountContract.delete({ where: { id: accountId } });
    await json(await call(`${accountRoute}/cleanup`, {}, other));
    assert.ok(
      await prisma.contractProgress.findFirst({
        where: { userId: owner, accountContractId: accountId },
      }),
    );
    await json(await call(`${accountRoute}/cleanup`, {}));
    await assert.rejects(fs.stat(accountCopy.storedPath), { code: 'ENOENT' });

    const files = await prisma.signedContractCopy.findMany({
      where: { progress: { userId: owner, draftId: draft.id } },
    });
    await json(await call(`/api/filing/drafts/${draft.id}/delete`, {}));
    assert.equal(
      await prisma.contractProgress.count({ where: { userId: owner } }),
      0,
    );
    for (const file of files)
      await assert.rejects(fs.stat(file.storedPath), { code: 'ENOENT' });
  } finally {
    const copies = await prisma.signedContractCopy.findMany({
      where: { progress: { userId: { in: [owner, other] } } },
    });
    await cleanupSignedCopies(copies);
    await prisma.contractProgress.deleteMany({
      where: { userId: { in: [owner, other] } },
    });
    if (template) {
      await prisma.contractDraft.deleteMany({
        where: { templateId: template.id },
      });
      await prisma.contractFile.delete({ where: { id: template.id } });
    }
    await prisma.accountUser.deleteMany({ where: { id: owner } });
    await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect();
  }
});
