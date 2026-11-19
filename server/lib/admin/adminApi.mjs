import { prisma } from '../prisma.mjs';
import { ensureContractLibrary } from '../contractFiling/libraryLoader.mjs';
import { updateTicket, ticketIncludes, ticketListSelect } from '../support/supportApi.mjs';
import { archiveLibrary, fail, libraryEntry, pagination, platformSummary, text, updateLibrary, updateUser, userSelect } from './adminService.mjs';

export async function handleAdminRoutes(req, res, { url, sendJson, readBody, requireAuth }) {
  if (!url.pathname.startsWith('/api/admin/')) return false;
  const { user } = await requireAuth(req);
  if (user.app_metadata?.role !== 'admin') throw fail('Administrator access required.', 403);
  const { pathname } = url;
  const query = text(url.searchParams.get('q') || '', 'Search', 160, false);
  const { page, take, skip } = pagination(url);
  const list = async (model, where, options = {}) => {
    const [items, total] = await Promise.all([model.findMany({ where, take, skip, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...options }), model.count({ where })]);
    return { items, total, page, pageSize: take };
  };
  if (req.method === 'GET' && pathname === '/api/admin/summary') {
    await ensureContractLibrary();
    sendJson(res, 200, await platformSummary()); return true;
  }
  if (req.method === 'GET' && pathname === '/api/admin/users') {
    const status = url.searchParams.get('status'), role = url.searchParams.get('role');
    const where = { ...(query ? { OR: ['name', 'email'].map(field => ({ [field]: { contains: query, mode: 'insensitive' } })) } : {}),
      ...(['admin', 'member'].includes(role) ? { role } : {}),
      ...(status === 'suspended' ? { suspendedAt: { not: null } } : status === 'active' ? { suspendedAt: null, emailVerifiedAt: { not: null } } : status === 'unconfirmed' ? { suspendedAt: null, emailVerifiedAt: null } : {}) };
    sendJson(res, 200, await list(prisma.accountUser, where, { select: userSelect })); return true;
  }
  const userMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)(?:\/(update))?$/);
  if (userMatch && req.method === 'GET' && !userMatch[2]) {
    const account = await prisma.accountUser.findUnique({ where: { id: userMatch[1] }, select: userSelect });
    if (!account) throw fail('Account not found.', 404);
    const [projects, drafts, contracts, tickets] = await Promise.all([
      prisma.musicProject.count({ where: { userId: account.id } }), prisma.contractDraft.count({ where: { userId: account.id } }),
      prisma.accountContract.count({ where: { userId: account.id } }), prisma.supportTicket.count({ where: { userId: account.id } }),
    ]);
    sendJson(res, 200, { ...account, usage: { projects, contracts: drafts + contracts, tickets } }); return true;
  }
  if (userMatch && req.method === 'POST' && userMatch[2]) {
    const body = await readBody(req, 8000); if (!body) throw fail('Enter account details.');
    sendJson(res, 200, await updateUser(user, userMatch[1], body)); return true;
  }
  if (req.method === 'GET' && pathname === '/api/admin/library') {
    await ensureContractLibrary();
    const state = url.searchParams.get('status');
    const where = { ...(state === 'archived' ? { archivedAt: { not: null } } : state === 'all' ? {} : { archivedAt: null }),
      ...(state === 'review' ? { needsReview: true } : {}),
      ...(query ? { OR: ['originalName', 'title', 'displayTitle', 'category', 'displayCategory'].map(field => ({ [field]: { contains: query, mode: 'insensitive' } })) } : {}) };
    const result = await list(prisma.contractFile, where, { include: { _count: { select: { drafts: true } } } });
    sendJson(res, 200, { ...result, items: result.items.map(libraryEntry) }); return true;
  }
  const libraryMatch = pathname.match(/^\/api\/admin\/library\/([^/]+)(?:\/(update|archive))?$/);
  if (libraryMatch && req.method === 'GET' && !libraryMatch[2]) {
    const file = await prisma.contractFile.findUnique({ where: { id: libraryMatch[1] }, include: { _count: { select: { drafts: true } } } });
    if (!file) throw fail('Document not found.', 404);
    sendJson(res, 200, { ...libraryEntry(file), text: file.extractedText || '' }); return true;
  }
  if (libraryMatch && req.method === 'POST' && libraryMatch[2]) {
    const body = await readBody(req, 16000); if (!body) throw fail('Enter document details.');
    sendJson(res, 200, await (libraryMatch[2] === 'archive' ? archiveLibrary : updateLibrary)(user, libraryMatch[1], body)); return true;
  }
  if (req.method === 'GET' && pathname === '/api/admin/tickets') {
    const status = url.searchParams.get('status'), kind = url.searchParams.get('kind');
    const where = {
      ...(['open', 'in_progress', 'resolved', 'dismissed'].includes(status) ? { status } : {}),
      ...(['support', 'report'].includes(kind) ? { kind } : {}),
      ...(query ? { OR: [{ subject: { contains: query, mode: 'insensitive' } }, { user: { email: { contains: query, mode: 'insensitive' } } }] } : {}),
    };
    sendJson(res, 200, await list(prisma.supportTicket, where, { select: { ...ticketListSelect, user: { select: { id: true, name: true, email: true } } }, orderBy: [{ priority: 'asc' }, { updatedAt: 'desc' }, { id: 'desc' }] })); return true;
  }
  const ticketMatch = pathname.match(/^\/api\/admin\/tickets\/([^/]+)(?:\/(update))?$/);
  if (ticketMatch && req.method === 'GET' && !ticketMatch[2]) {
    const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketMatch[1] }, include: ticketIncludes(true) });
    if (!ticket) throw fail('Request not found.', 404);
    sendJson(res, 200, ticket); return true;
  }
  if (ticketMatch && req.method === 'POST' && ticketMatch[2]) {
    const body = await readBody(req, 24000); if (!body) throw fail('Enter request details.');
    sendJson(res, 200, await updateTicket(user, ticketMatch[1], body)); return true;
  }
  if (req.method === 'GET' && pathname === '/api/admin/activity') {
    const where = query ? { OR: ['actorName', 'action', 'description'].map(field => ({ [field]: { contains: query, mode: 'insensitive' } })) } : {};
    sendJson(res, 200, await list(prisma.platformActivity, where)); return true;
  }
  sendJson(res, 404, { error: 'Admin endpoint not found.' }); return true;
}
