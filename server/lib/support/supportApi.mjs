import { prisma } from '../prisma.mjs';
import { rateLimit } from '../auth/localAuth.mjs';
import { describeLibraryFile } from '../contractFiling/libraryCatalog.mjs';
import { adminTransaction, fail, pagination, text, versionInput } from '../admin/adminService.mjs';
import { recordActivity } from '../admin/activity.mjs';

export const ticketListSelect = { id: true, userId: true, kind: true, subject: true, targetId: true, targetTitle: true, status: true, priority: true, version: true, createdAt: true, updatedAt: true };
const userSummary = { id: true, name: true, email: true };
export const ticketIncludes = (admin = false) => ({
  replies: { ...(admin ? {} : { where: { isInternal: false } }), orderBy: { createdAt: 'asc' } },
  ...(admin ? { user: { select: userSummary } } : {}),
});

export async function updateTicket(actor, id, body) {
  const version = versionInput(body);
  if (!['open', 'in_progress', 'resolved', 'dismissed'].includes(body.status) || !['normal', 'high'].includes(body.priority)) throw fail('Choose a valid status and priority.');
  const response = text(body.response || '', 'Response', 5000, false);
  const note = text(body.note || '', 'Internal note', 5000, false);
  return adminTransaction(actor, async (db) => {
    const changed = await db.supportTicket.updateMany({ where: { id, version }, data: { status: body.status, priority: body.priority, version: { increment: 1 } } });
    if (!changed.count) throw fail('This request changed. Refresh it before saving.', 409);
    for (const [content, isInternal] of [[response, false], [note, true]]) {
      if (content) await db.supportReply.create({ data: { ticketId: id, authorId: actor.id, authorName: actor.user_metadata?.name || 'Administrator', isStaff: true, isInternal, body: content } });
    }
    await recordActivity(actor, 'ticket.updated', 'ticket', id, `Set request to ${body.status.replace('_', ' ')} (${body.priority} priority)${response ? '; replied to the member' : ''}${note ? '; added an internal note' : ''}.`, db);
    return db.supportTicket.findUniqueOrThrow({ where: { id }, include: ticketIncludes(true) });
  });
}

export async function handleSupportRoutes(req, res, ctx) {
  const { url, sendJson, readBody, requireAuth } = ctx;
  if (!url.pathname.startsWith('/api/support/')) return false;
  const { user } = await requireAuth(req);
  if (url.pathname === '/api/support/tickets' && req.method === 'GET') {
    const { page, take, skip } = pagination(url);
    const where = { userId: user.id };
    const [items, total] = await Promise.all([
      prisma.supportTicket.findMany({ where, select: ticketListSelect, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take, skip }), prisma.supportTicket.count({ where }),
    ]);
    sendJson(res, 200, { items, total, page, pageSize: take }); return true;
  }
  if (url.pathname === '/api/support/tickets' && req.method === 'POST') {
    const body = await readBody(req, 16000);
    if (!body || !['support', 'report'].includes(body.kind)) throw fail('Choose support or report.');
    const subject = text(body.subject, 'Subject');
    const message = text(body.message, 'Message', 5000);
    await rateLimit(req, 'support-create', user.email, 5);
    let target = null;
    if (body.targetId) {
      if (body.kind !== 'report' || typeof body.targetId !== 'string') throw fail('Only a document report can link a library item.');
      target = await prisma.contractFile.findFirst({ where: { id: body.targetId, archivedAt: null } });
      if (!target) throw fail('The library document is unavailable.', 404);
    }
    const ticket = await prisma.$transaction(async (db) => {
      const created = await db.supportTicket.create({ data: {
        userId: user.id, kind: body.kind, subject, message, targetId: target?.id || null, targetTitle: target ? describeLibraryFile(target).title : null,
      } });
      await recordActivity(user, body.kind === 'report' ? 'report.created' : 'support.created', 'ticket', created.id, `Submitted a ${body.kind === 'report' ? 'content report' : 'support request'}.`, db);
      return created;
    });
    sendJson(res, 201, ticket); return true;
  }
  const match = url.pathname.match(/^\/api\/support\/tickets\/([^/]+)(?:\/(reply))?$/);
  if (match && req.method === 'GET' && !match[2]) {
    const ticket = await prisma.supportTicket.findFirst({ where: { id: match[1], userId: user.id }, include: ticketIncludes() });
    if (!ticket) throw fail('Request not found.', 404);
    sendJson(res, 200, ticket); return true;
  }
  if (match && req.method === 'POST' && match[2]) {
    const existing = await prisma.supportTicket.findFirst({ where: { id: match[1], userId: user.id } });
    if (!existing) throw fail('Request not found.', 404);
    const body = await readBody(req, 16000);
    const message = text(body?.message, 'Reply', 5000);
    await rateLimit(req, 'support-reply', user.email, 12);
    const ticket = await prisma.$transaction(async (db) => {
      await db.$queryRaw`SELECT "id" FROM "SupportTicket" WHERE "id" = ${existing.id} FOR UPDATE`;
      const current = await db.supportTicket.findUniqueOrThrow({ where: { id: existing.id } });
      await db.supportTicket.update({ where: { id: existing.id }, data: {
        status: ['resolved', 'dismissed'].includes(current.status) ? 'open' : current.status,
        version: { increment: 1 },
        replies: { create: { authorId: user.id, authorName: user.user_metadata?.name || 'Member', body: message } },
      } });
      await recordActivity(user, 'support.reply', 'ticket', existing.id, 'Replied to a support request or report.', db);
      return db.supportTicket.findUniqueOrThrow({ where: { id: existing.id }, include: ticketIncludes() });
    });
    sendJson(res, 200, ticket); return true;
  }
  sendJson(res, 404, { error: 'Support endpoint not found.' }); return true;
}
