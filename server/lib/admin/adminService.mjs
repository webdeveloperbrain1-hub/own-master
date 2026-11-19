import { prisma } from '../prisma.mjs';
import { describeLibraryFile } from '../contractFiling/libraryCatalog.mjs';
import { recordActivity } from './activity.mjs';

export const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export const text = (value, label, max = 160, required = true) => {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()) || /\u0000/.test(value))
    throw fail(`${label} ${required ? 'is required and ' : ''}must be at most ${max} characters.`);
  return value.trim();
};
export function pagination(url) {
  const page = Number(url.searchParams.get('page') || 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw fail('Choose a valid page.');
  return { page, take: 25, skip: (page - 1) * 25 };
}
export function versionInput(body) {
  if (!Number.isSafeInteger(body.version) || body.version < 0) throw fail('Refresh this item before saving.');
  return body.version;
}
export const userSelect = { id: true, email: true, name: true, role: true, emailVerifiedAt: true, suspendedAt: true, suspensionReason: true, lastLoginAt: true, lastActiveAt: true, createdAt: true, updatedAt: true };

export async function adminTransaction(actor, work) {
  return prisma.$transaction(async (db) => {
    // All privilege changes serialize, including attempts by two different
    // admins. Re-check the actor after the lock to prevent stale-role writes.
    await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('own-masters-administration'))::text`;
    const current = await db.accountUser.findUnique({ where: { id: actor.id } });
    if (!current || current.role !== 'admin' || current.suspendedAt || !current.emailVerifiedAt)
      throw fail('Administrator access required.', 403);
    return work(db);
  }, { timeout: 15000 });
}

export async function updateUser(actor, id, body) {
  if (!['member', 'admin'].includes(body.role) || typeof body.suspended !== 'boolean') throw fail('Choose a valid role and account status.');
  const reason = text(body.reason || '', 'Suspension reason', 500, false);
  if (body.suspended && !reason) throw fail('Enter a reason for suspending this account.');
  return adminTransaction(actor, async (db) => {
    const target = await db.accountUser.findUnique({ where: { id } });
    if (!target) throw fail('Account not found.', 404);
    if (typeof body.updatedAt !== 'string' || new Date(body.updatedAt).getTime() !== target.updatedAt.getTime())
      throw fail('This account changed. Refresh it before saving.', 409);
    const name = body.name === undefined ? target.name : text(body.name, 'Display name', 120);
    if (/[\u0000-\u001f]/.test(name)) throw fail('Enter a valid display name.');
    if (id === actor.id && (body.role !== 'admin' || body.suspended)) throw fail('You cannot suspend or remove your own administrator access.');
    if (body.role === 'admin' && !target.emailVerifiedAt) throw fail('An account must confirm its email before becoming an administrator.');
    if (target.role === 'admin' && !target.suspendedAt && (body.role !== 'admin' || body.suspended)) {
      const activeAdmins = await db.accountUser.count({ where: { role: 'admin', suspendedAt: null, emailVerifiedAt: { not: null } } });
      if (activeAdmins <= 1) throw fail('Keep at least one active administrator.', 409);
    }
    const changedAccess = body.role !== target.role || body.suspended !== Boolean(target.suspendedAt);
    const updated = await db.accountUser.update({ where: { id }, data: {
      name, role: body.role, suspendedAt: body.suspended ? target.suspendedAt || new Date() : null,
      suspensionReason: body.suspended ? reason : null,
    }, select: userSelect });
    if (changedAccess) {
      await db.accountSession.deleteMany({ where: { userId: id } });
      await db.passwordResetToken.deleteMany({ where: { userId: id } });
    }
    await recordActivity(actor, 'user.updated', 'user', id, `${target.email}: ${name !== target.name ? 'updated display name; ' : ''}role ${target.role} → ${body.role}; ${body.suspended ? 'suspended' : 'active'}.`, db);
    return updated;
  });
}

export function libraryEntry(file) {
  const details = describeLibraryFile(file);
  return { id: file.id, originalName: file.originalName, ...details, summary: file.displayDescription ?? file.summary ?? '',
    archivedAt: file.archivedAt, needsReview: file.needsReview, reviewedAt: file.reviewedAt, reviewNote: file.reviewNote || '',
    extractionStatus: file.extractionStatus, extractionWarnings: file.extractionWarnings, textLength: file.textLength,
    version: file.version, updatedAt: file.updatedAt, draftCount: file._count?.drafts || 0 };
}

export async function updateLibrary(actor, id, body) {
  const version = versionInput(body);
  const title = text(body.title, 'Title');
  const category = text(body.category, 'Category', 100);
  const description = text(body.description, 'Description', 2000, false);
  const reviewNote = text(body.reviewNote || '', 'Review note', 2000, false);
  if (!['template', 'guide'].includes(body.kind) || typeof body.reviewed !== 'boolean') throw fail('Choose a document type and review status.');
  return adminTransaction(actor, async (db) => {
    const changed = await db.contractFile.updateMany({ where: { id, version }, data: {
      displayTitle: title, displayCategory: category, displayDescription: description, libraryKind: body.kind,
      reviewedAt: body.reviewed ? new Date() : null, reviewedBy: body.reviewed ? actor.id : null,
      needsReview: !body.reviewed, reviewNote, version: { increment: 1 },
    } });
    if (!changed.count) throw fail('The document changed or is unavailable. Refresh before saving.', 409);
    const file = await db.contractFile.findUniqueOrThrow({ where: { id }, include: { _count: { select: { drafts: true } } } });
    await recordActivity(actor, 'library.updated', 'library', id, `Updated ${title}${body.reviewed ? ' and marked it reviewed' : ''}.`, db);
    return libraryEntry(file);
  });
}

export async function archiveLibrary(actor, id, body) {
  const version = versionInput(body);
  if (typeof body.archived !== 'boolean') throw fail('Choose whether to archive or restore the document.');
  return adminTransaction(actor, async (db) => {
    const changed = await db.contractFile.updateMany({ where: { id, version }, data: {
      archivedAt: body.archived ? new Date() : null, version: { increment: 1 },
    } });
    if (!changed.count) throw fail('The document changed or is unavailable. Refresh before saving.', 409);
    const file = await db.contractFile.findUniqueOrThrow({ where: { id }, include: { _count: { select: { drafts: true } } } });
    await recordActivity(actor, body.archived ? 'library.archived' : 'library.restored', 'library', id, `${body.archived ? 'Archived' : 'Restored'} ${describeLibraryFile(file).title}.`, db);
    return libraryEntry(file);
  });
}

export async function platformSummary() {
  const since = new Date(); since.setUTCHours(0, 0, 0, 0); since.setUTCDate(since.getUTCDate() - 13);
  const [users, activeUsers, suspendedUsers, admins, documents, archivedDocuments, needsReview, projects, drafts, contracts, signedCopies, openTickets, rows] = await Promise.all([
    prisma.accountUser.count(), prisma.accountUser.count({ where: { lastActiveAt: { gte: new Date(Date.now() - 30 * 86400000) }, suspendedAt: null } }),
    prisma.accountUser.count({ where: { suspendedAt: { not: null } } }), prisma.accountUser.count({ where: { role: 'admin', suspendedAt: null, emailVerifiedAt: { not: null } } }),
    prisma.contractFile.count({ where: { archivedAt: null } }), prisma.contractFile.count({ where: { archivedAt: { not: null } } }),
    prisma.contractFile.count({ where: { archivedAt: null, needsReview: true } }), prisma.musicProject.count(), prisma.contractDraft.count(), prisma.accountContract.count(),
    prisma.signedContractCopy.count(), prisma.supportTicket.count({ where: { status: { in: ['open', 'in_progress'] } } }),
    prisma.$queryRaw`SELECT to_char("createdAt", 'YYYY-MM-DD') AS day, 'users' AS kind, COUNT(*)::int AS count FROM "AccountUser" WHERE "createdAt" >= ${since} GROUP BY day
      UNION ALL SELECT to_char("createdAt", 'YYYY-MM-DD'), 'projects', COUNT(*)::int FROM "MusicProject" WHERE "createdAt" >= ${since} GROUP BY 1
      UNION ALL SELECT to_char("createdAt", 'YYYY-MM-DD'), 'contracts', COUNT(*)::int FROM "ContractDraft" WHERE "createdAt" >= ${since} GROUP BY 1
      UNION ALL SELECT to_char("createdAt", 'YYYY-MM-DD'), 'contracts', COUNT(*)::int FROM "AccountContract" WHERE "createdAt" >= ${since} GROUP BY 1
      UNION ALL SELECT to_char("createdAt", 'YYYY-MM-DD'), 'tickets', COUNT(*)::int FROM "SupportTicket" WHERE "createdAt" >= ${since} GROUP BY 1`,
  ]);
  const daily = Array.from({ length: 14 }, (_, index) => ({ day: new Date(since.getTime() + index * 86400000).toISOString().slice(0, 10), users: 0, projects: 0, contracts: 0, tickets: 0 }));
  for (const row of rows) { const day = daily.find(item => item.day === row.day); if (day) day[row.kind] += row.count; }
  return { totals: { users, activeUsers, suspendedUsers, admins, documents, archivedDocuments, needsReview, projects, contracts: drafts + contracts, signedCopies, openTickets }, daily };
}
