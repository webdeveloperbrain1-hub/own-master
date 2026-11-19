import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import PDFDocument from 'pdfkit';
import { loadEnv } from '../server/lib/env.mjs';
import { prisma } from '../server/lib/prisma.mjs';
import { handleAuthRoutes, requireLocalAuth, assertTrustedMutation, hashPassword } from '../server/lib/auth/localAuth.mjs';
import { handleAdminRoutes } from '../server/lib/admin/adminApi.mjs';
import { handleSupportRoutes } from '../server/lib/support/supportApi.mjs';
import { handleFilingRoutes } from '../server/lib/contractFiling/filingApi.mjs';
import { handleBillingRoutes } from '../server/lib/billing/billingApi.mjs';
import { handleTemplateLibraryRoutes } from '../server/lib/contracts/templateLibraryApi.mjs';
import { fillContractTemplate } from '../server/lib/contracts/contractFillService.mjs';
import { handleProjectRoutes } from '../server/lib/projects/projectApi.mjs';
import { handleAccountContractRoutes } from '../server/lib/contracts/accountContracts.mjs';

loadEnv();

test('administrator tools enforce roles, preserve drafts, isolate support notes, and report real usage', async t => {
  const run = randomUUID(); const password = 'Trial-password1!'; const users = []; const files = []; const legacyTemplates = [];
  const server = createServer(async (req, res) => {
    const sendJson = (response, status, body) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); };
    try {
      assertTrustedMutation(req);
      const ctx = { url: new URL(req.url, 'http://localhost'), sendJson, requireAuth: requireLocalAuth,
        readBody: async () => { const chunks = []; for await (const chunk of req) chunks.push(chunk); return JSON.parse(Buffer.concat(chunks)); } };
      if (await handleAuthRoutes({ method: req.method, headers: req.headers, socket: { remoteAddress: `admin-test-${run}` } }, res, ctx)) return;
      if (await handleAdminRoutes(req, res, ctx)) return;
      if (await handleSupportRoutes(req, res, ctx)) return;
      if (await handleFilingRoutes(req, res, ctx)) return;
      if (await handleBillingRoutes(req, res, ctx)) return;
      if (await handleTemplateLibraryRoutes(req, res, ctx)) return;
      if (await handleProjectRoutes(req, res, ctx)) return;
      if (await handleAccountContractRoutes(req, res, ctx)) return;
      sendJson(res, 404, { error: 'Not found.' });
    } catch (error) { sendJson(res, error.status || 500, { error: error.message, code: error.code }); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let cookie = '';
    return { async call(path, body, headers = {}, raw = false) {
      const response = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: {
        'Content-Type': raw ? 'application/octet-stream' : 'application/json', 'X-Own-Masters-Request': 'true', Cookie: cookie, ...headers,
      }, ...(body === undefined ? {} : { body: raw ? body : JSON.stringify(body) }) });
      if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
      return response;
    } };
  };
  const json = async (response, status = 200) => { const body = await response.json(); assert.equal(response.status, status, JSON.stringify(body)); return body; };
  let documentId, draftId, ticketId;
  const [a, b, member, other, guest] = Array.from({ length: 5 }, client);
  try {
    const passwordHash = await hashPassword(password);
    for (const [index, role] of ['admin', 'admin', 'member', 'member', 'member'].entries()) users.push(await prisma.accountUser.create({ data: {
      name: `Admin test ${index}`, email: `admin-${index}-${run}@example.test`, role, passwordHash,
      emailVerifiedAt: index === 4 ? null : new Date(),
    } }));
    for (const [index, browser] of [a, b, member, other].entries()) await json(await browser.call('/api/auth/login', { email: users[index].email, password }));
    await t.test('members cannot obtain administrator data or mutate access using forged fields', async () => {
      for (const route of ['summary', 'users', 'library', 'tickets', 'activity']) {
        await json(await guest.call(`/api/admin/${route}`), 401);
        await json(await member.call(`/api/admin/${route}`, undefined, { 'X-Own-Masters-Role': 'admin' }), 403);
      }
      await json(await member.call(`/api/admin/users/${users[2].id}/update`, { role: 'admin', suspended: false, updatedAt: users[2].updatedAt.toISOString() }), 403);
      const list = await json(await a.call(`/api/admin/users?q=${encodeURIComponent(run)}`));
      assert.equal(list.total, 5);
      const active = await json(await a.call(`/api/admin/users?q=${encodeURIComponent(run)}&status=active`));
      assert.equal(active.total, 4);
      assert.ok(active.items.every(account => account.emailVerifiedAt && !account.suspendedAt));
      const pendingAccounts = await json(await a.call(`/api/admin/users?q=${encodeURIComponent(run)}&status=unconfirmed`));
      assert.equal(pendingAccounts.total, 1);
      assert.equal(pendingAccounts.items[0].id, users[4].id);
      const admins = await json(await a.call(`/api/admin/users?q=${encodeURIComponent(run)}&role=admin`));
      assert.equal(admins.total, 2);
      assert.ok(admins.items.every(account => account.role === 'admin'));
      assert.equal(JSON.stringify(list).includes('passwordHash'), false);
      assert.equal(JSON.stringify(list).includes(passwordHash), false);
      await json(await a.call('/api/admin/users?page=NaN'), 400);
      const self = await json(await a.call(`/api/admin/users/${users[0].id}`));
      await json(await a.call(`/api/admin/users/${self.id}/update`, { role: 'member', suspended: false, updatedAt: self.updatedAt }), 400);
      await json(await a.call(`/api/admin/users/${self.id}/update`, { role: 'admin', suspended: true, reason: 'Test', updatedAt: self.updatedAt }), 400);
      const pending = await json(await a.call(`/api/admin/users/${users[4].id}`));
      await json(await a.call(`/api/admin/users/${pending.id}/update`, { role: 'admin', suspended: false, updatedAt: pending.updatedAt }), 400);
    });
    await t.test('legacy template reads require a session, hide unapproved sources, and scope member usage', async () => {
      for (const [approved, aiScanStatus] of [[true, 'scanned'], [false, 'not_scanned'], [true, 'needs_review']]) legacyTemplates.push(await prisma.contractTemplate.create({ data: {
        name: `Legacy role review ${run}`, originalFileName: 'role-review.txt', storagePath: 'not-a-real-source', fileType: 'txt', approved, aiScanStatus, extractedText: 'Role review fixture.', fieldSchema: { fields: [] },
      } }));
      const [approved, pending, needsReview] = legacyTemplates;
      for (const path of ['/api/contracts/templates', '/api/contracts/templates?includeAll=true', `/api/contracts/templates/${approved.id}`, `/api/contracts/templates/${approved.id}/schema`])
        await json(await guest.call(path), 401);
      await json(await member.call('/api/contracts/templates?includeAll=true', undefined, { 'X-Own-Masters-Role': 'admin' }), 403);
      const memberList = await json(await member.call('/api/contracts/templates'));
      assert.ok(memberList.templates.some(template => template.id === approved.id));
      assert.ok(memberList.templates.every(template => template.approved && template.aiScanStatus === 'scanned'));
      for (const file of [pending, needsReview]) {
        await json(await member.call(`/api/contracts/templates/${file.id}`), 404);
        await json(await member.call(`/api/contracts/templates/${file.id}/schema`), 404);
        await assert.rejects(fillContractTemplate({ userId: users[2].id, templateId: file.id }), { status: 404 });
        await json(await a.call(`/api/contracts/templates/${file.id}`));
      }
      await prisma.generatedContract.createMany({ data: [users[2], users[3]].map(user => ({ userId: user.id, templateId: approved.id, title: 'Private generated fixture', dealData: {}, outputDocxPath: 'not-a-real-output' })) });
      assert.equal((await json(await member.call(`/api/contracts/templates/${approved.id}`))).template.generatedCount, 1);
      assert.equal((await json(await a.call(`/api/contracts/templates/${approved.id}`))).template.generatedCount, 2);
      const all = await json(await a.call('/api/contracts/templates?includeAll=true'));
      assert.ok(legacyTemplates.every(file => all.templates.some(template => template.id === file.id)));
    });
    await t.test('private projects and contracts stay owner-scoped even for website administrators', async () => {
      const project = await prisma.musicProject.create({ data: { userId: users[2].id, title: 'Private member project', lyrics: 'PRIVATE-ROLE-REVIEW' } });
      const contract = await prisma.accountContract.create({ data: { userId: users[2].id, title: 'Private member contract', contractType: 'Recording', content: 'PRIVATE-ROLE-REVIEW' } });
      await json(await member.call(`/api/projects/${project.id}`));
      await json(await member.call(`/api/account-contracts/${contract.id}`));
      for (const browser of [a, b, other]) {
        await json(await browser.call(`/api/projects/${project.id}`), 404);
        await json(await browser.call(`/api/account-contracts/${contract.id}`), 404);
      }
    });
    await t.test('administrators can edit user names without changing credentials or revoking their sessions', async () => {
      const target = await json(await a.call(`/api/admin/users/${users[3].id}`));
      const input = { role: target.role, suspended: false, updatedAt: target.updatedAt };
      for (const name of ['', 'a'.repeat(121), 'Invalid\u0001Name'])
        await json(await a.call(`/api/admin/users/${target.id}/update`, { ...input, name }), 400);
      const updated = await json(await a.call(`/api/admin/users/${target.id}/update`, { ...input, name: ' Updated member ' }));
      assert.equal(updated.name, 'Updated member');
      const session = await json(await other.call('/api/auth/session'));
      assert.equal(session.user.user_metadata.name, 'Updated member');
      assert.equal(session.user.app_metadata.role, 'member');
      await json(await a.call(`/api/admin/users/${target.id}/update`, { ...input, name: 'Stale edit' }), 409);
      const stored = await prisma.accountUser.findUniqueOrThrow({ where: { id: target.id } });
      assert.equal(stored.passwordHash, users[3].passwordHash);
    });
    await t.test('suspension revokes access immediately and reactivation requires a fresh login', async () => {
      const target = await json(await a.call(`/api/admin/users/${users[2].id}`));
      const body = { role: 'member', suspended: true, reason: 'Trial suspension', updatedAt: target.updatedAt };
      await json(await a.call(`/api/admin/users/${target.id}/update`, body, { 'X-Own-Masters-Request': '' }), 403);
      const suspended = await json(await a.call(`/api/admin/users/${target.id}/update`, body));
      assert.ok(suspended.suspendedAt);
      assert.equal(await prisma.accountSession.count({ where: { userId: target.id } }), 0);
      await json(await member.call('/api/support/tickets'), 401);
      const login = await json(await member.call('/api/auth/login', { email: target.email, password }), 403);
      assert.equal(login.code, 'account_suspended');
      assert.ok((await json(await other.call('/api/auth/session'))).user);
      const active = await json(await a.call(`/api/admin/users/${target.id}/update`, { role: 'member', suspended: false, updatedAt: suspended.updatedAt }));
      assert.equal(active.suspendedAt, null);
      await json(await member.call('/api/support/tickets'), 401);
      await json(await member.call('/api/auth/login', { email: target.email, password }));
      await json(await a.call(`/api/admin/users/${target.id}/update`, body), 409);
    });
    await t.test('library edits persist, archives do not cascade into saved drafts, and notes stay private', async () => {
      const pdf = new PDFDocument(); const chunks = [];
      const finished = new Promise(resolve => pdf.on('end', () => resolve(Buffer.concat(chunks))));
      pdf.on('data', chunk => chunks.push(chunk));
      pdf.text(`TRIAL RECORDING AGREEMENT ${run}\nArtist: __________\nProducer: __________\nPayment: $500\nThe parties agree to the recording services described in this agreement.`); pdf.end();
      const bytes = await finished;
      const route = `/api/filing/upload?name=${encodeURIComponent(`Admin fixture ${run}.pdf`)}`;
      await json(await member.call(route, bytes, {}, true), 403);
      const uploaded = await json(await a.call(route, bytes, {}, true), 201); documentId = uploaded.id;
      files.push((await prisma.contractFile.findUniqueOrThrow({ where: { id: documentId } })).storedPath);
      const details = await json(await a.call(`/api/admin/library/${documentId}`));
      const edited = await json(await a.call(`/api/admin/library/${documentId}/update`, {
        version: details.version, title: `Reviewed recording ${run}`, category: 'Trial category', kind: 'template', description: 'Description written by an administrator.', reviewed: true, reviewNote: 'INTERNAL-LIBRARY-REVIEW-NOTE',
      }));
      assert.equal(edited.needsReview, false);
      const entries = await json(await member.call(`/api/filing/templates?q=${encodeURIComponent(run)}`));
      assert.ok(entries.some(entry => entry.title === edited.title && entry.category === 'Trial category' && entry.analysisLabel === 'Reviewed by administrator'));
      const publicFile = await json(await member.call(`/api/filing/templates/${documentId}`));
      assert.equal(publicFile.reviewNote, undefined); assert.equal(publicFile.storedPath, undefined);
      const draft = await json(await member.call(`/api/filing/templates/${documentId}/drafts`, { name: 'Existing saved contract', renderedText: 'These saved contract terms must survive library removal.' })); draftId = draft.draft.id;
      const archived = await json(await a.call(`/api/admin/library/${documentId}/archive`, { archived: true, version: edited.version }));
      assert.ok(archived.archivedAt);
      assert.equal((await json(await member.call(`/api/filing/templates?q=${encodeURIComponent(run)}`))).some(entry => entry.id === documentId), false);
      await json(await other.call(`/api/filing/templates/${documentId}/fill`), 404);
      await json(await member.call(`/api/filing/templates/${documentId}/drafts`, { name: 'New draft', renderedText: 'New draft from archived source' }), 404);
      const saved = await json(await member.call(`/api/filing/drafts/${draftId}`));
      assert.equal(saved.renderedText, 'These saved contract terms must survive library removal.');
      assert.equal(saved.template.reviewNote, undefined);
      await json(await member.call(`/api/filing/templates/${documentId}/fill`));
      assert.equal((await member.call(`/api/filing/drafts/${draftId}/download?format=docx`)).status, 200);
      const restored = await json(await a.call(`/api/admin/library/${documentId}/archive`, { archived: false, version: archived.version }));
      await json(await a.call(`/api/admin/library/${documentId}/archive`, { archived: true, version: archived.version }), 409);
      await json(await a.call(`/api/admin/library/${documentId}/update`, { version: restored.version, title: `Trial guide ${run}`, category: 'Reference', kind: 'guide', description: 'A reviewed reference guide.', reviewed: true, reviewNote: '' }));
      const guide = await json(await member.call(`/api/filing/guides/${documentId}`));
      assert.equal(guide.title, `Trial guide ${run}`);
      assert.equal(guide.readOnly, true);
    });
    await t.test('reports and support replies are owner-scoped; internal staff notes cannot reach members', async () => {
      const created = await json(await member.call('/api/support/tickets', { userId: users[3].id, kind: 'report', subject: `Report ${run}`, message: 'Please review this document.', targetId: documentId }), 201); ticketId = created.id;
      assert.equal(created.userId, users[2].id);
      assert.equal(created.targetTitle, `Trial guide ${run}`);
      await json(await other.call(`/api/support/tickets/${ticketId}`), 404);
      await json(await other.call(`/api/support/tickets/${ticketId}/reply`, { message: 'Cross-account reply' }), 404);
      const response = await json(await a.call(`/api/admin/tickets/${ticketId}/update`, { version: 0, status: 'in_progress', priority: 'high', response: 'We are reviewing your report.', note: 'SECRET-STAFF-NOTE' }));
      assert.equal(response.replies.length, 2);
      const memberView = await json(await member.call(`/api/support/tickets/${ticketId}`));
      assert.equal(memberView.replies.length, 1);
      assert.equal(JSON.stringify(memberView).includes('SECRET-STAFF-NOTE'), false);
      const reply = await json(await member.call(`/api/support/tickets/${ticketId}/reply`, { message: 'More information from the member.', isInternal: true, isStaff: true }));
      assert.equal(reply.replies.at(-1).isStaff, false);
      assert.equal(reply.replies.at(-1).isInternal, false);
      await json(await a.call(`/api/admin/tickets/${ticketId}/update`, { version: 1, status: 'resolved', priority: 'normal', response: 'Stale reply must not be sent.', note: '' }), 409);
      const resolved = await json(await a.call(`/api/admin/tickets/${ticketId}/update`, { version: reply.version, status: 'resolved', priority: 'normal', response: 'The library document has been reviewed.', note: '' }));
      const reopened = await json(await member.call(`/api/support/tickets/${ticketId}/reply`, { message: 'I still need help.' }));
      assert.equal(reopened.status, 'open');
      assert.equal(reopened.version, resolved.version + 1);
      const queue = await json(await a.call('/api/admin/tickets?kind=report&status=open'));
      assert.ok(queue.items.some(ticket => ticket.id === ticketId));
      assert.equal(JSON.stringify(queue).includes('SECRET-STAFF-NOTE'), false);
      const audit = await json(await a.call('/api/admin/activity?q=ticket.updated'));
      assert.ok(audit.items.some(event => event.entityId === ticketId));
      assert.equal(JSON.stringify(audit).includes('SECRET-STAFF-NOTE'), false);
      await json(await member.call('/api/support/tickets', { kind: 'report', subject: 'Missing document', message: 'Test', targetId: 'not-a-document' }), 404);
    });
    await t.test('overview returns current counts and fourteen daily totals without exposing document bodies', async () => {
      const before = await json(await a.call('/api/admin/summary'));
      await prisma.musicProject.create({ data: { userId: users[2].id, title: `Stats fixture ${run}` } });
      await prisma.accountContract.create({ data: { userId: users[2].id, title: 'Stats contract', contractType: 'Recording', content: 'PRIVATE-CONTRACT-BODY' } });
      const after = await json(await a.call('/api/admin/summary'));
      assert.equal(after.totals.projects, before.totals.projects + 1);
      assert.equal(after.totals.contracts, before.totals.contracts + 1);
      assert.equal(after.daily.length, 14);
      assert.equal(after.daily.at(-1).projects, before.daily.at(-1).projects + 1);
      assert.ok(after.totals.activeUsers >= 4);
      assert.equal(JSON.stringify(after).includes('PRIVATE-CONTRACT-BODY'), false);
    });
    await t.test('role updates revoke old sessions and stale administrators cannot win competing privilege changes', async () => {
      const target = await json(await a.call(`/api/admin/users/${users[2].id}`));
      await json(await a.call(`/api/admin/users/${target.id}/update`, { role: 'admin', suspended: false, updatedAt: target.updatedAt }));
      await json(await member.call('/api/admin/users'), 401);
      await json(await member.call('/api/auth/login', { email: target.email, password }));
      assert.equal((await json(await member.call('/api/billing/status'))).plan, 'admin');
      assert.equal((await json(await member.call('/api/billing/status'))).canExport, true);
      const aTarget = await json(await b.call(`/api/admin/users/${users[0].id}`));
      const bTarget = await json(await a.call(`/api/admin/users/${users[1].id}`));
      const competing = await Promise.all([
        a.call(`/api/admin/users/${bTarget.id}/update`, { role: 'member', suspended: false, updatedAt: bTarget.updatedAt }),
        b.call(`/api/admin/users/${aTarget.id}/update`, { role: 'member', suspended: false, updatedAt: aTarget.updatedAt }),
      ]);
      assert.equal(competing.filter(response => response.status === 200).length, 1);
      assert.equal(competing.filter(response => [401, 403].includes(response.status)).length, 1);
    });
    await t.test('operator provisioning restores a suspended administrator and revokes old access tokens', async () => {
      const target = users[3];
      await prisma.accountUser.update({ where: { id: target.id }, data: { suspendedAt: new Date(), suspensionReason: 'Recovery fixture' } });
      await prisma.passwordResetToken.create({ data: { userId: target.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 60000) } });
      const { stdout } = await promisify(execFile)(process.execPath, ['tools/maintenance/provisionAdmin.mjs'], {
        env: { ...process.env, ADMIN_EMAIL: target.email, ADMIN_PASSWORD: password }, windowsHide: true,
      });
      assert.match(stdout, /Administrator ready/);
      const restored = await prisma.accountUser.findUniqueOrThrow({ where: { id: target.id } });
      assert.equal(restored.role, 'admin');
      assert.equal(restored.suspendedAt, null);
      assert.equal(restored.suspensionReason, null);
      assert.equal(await prisma.accountSession.count({ where: { userId: target.id } }), 0);
      assert.equal(await prisma.passwordResetToken.count({ where: { userId: target.id } }), 0);
      await json(await other.call('/api/admin/users'), 401);
      const login = await json(await other.call('/api/auth/login', { email: target.email, password }));
      assert.equal(login.user.app_metadata.role, 'admin');
      await json(await other.call('/api/admin/users'));
      await json(await other.call('/api/admin/library'));
      assert.equal((await json(await other.call('/api/billing/status'))).plan, 'admin');
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
    const ids = users.map(user => user.id);
    await prisma.platformActivity.deleteMany({ where: { actorId: { in: ids } } });
    await prisma.musicProject.deleteMany({ where: { userId: { in: ids } } });
    await prisma.generatedContract.deleteMany({ where: { templateId: { in: legacyTemplates.map(file => file.id) } } });
    await prisma.contractTemplate.deleteMany({ where: { id: { in: legacyTemplates.map(file => file.id) } } });
    if (draftId) await prisma.contractDraft.deleteMany({ where: { id: draftId } });
    if (documentId) await prisma.contractFile.deleteMany({ where: { id: documentId } });
    await prisma.accountUser.deleteMany({ where: { id: { in: ids } } });
    await Promise.all(files.map(file => fs.rm(file, { force: true })));
    await prisma.$disconnect();
  }
});
