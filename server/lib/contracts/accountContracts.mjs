import { prisma } from '../prisma.mjs';
import { cleanupSignedCopies } from './contractProgress.mjs';
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const string = (value, name, max, required = false) => {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (required && !value.trim())
  )
    throw fail(`Enter ${name} up to ${max.toLocaleString()} characters.`);
  return value.trim();
};
export async function ownedAccountContract(userId, id) {
  const contract = await prisma.accountContract.findFirst({
    where: { id, userId },
  });
  if (!contract) throw fail('Contract not found.', 404);
  return contract;
}
export async function handleAccountContractRoutes(
  req,
  res,
  { url, sendJson, readBody, requireAuth },
) {
  const match =
    /^\/api\/account-contracts(?:\/([^/]+)(?:\/(update|delete))?)?$/.exec(
      url.pathname,
    );
  if (!match) return false;
  const { user } = await requireAuth(req);
  const [, id, action] = match;
  if (!id && req.method === 'GET') {
    sendJson(
      res,
      200,
      await prisma.accountContract.findMany({
        where: { userId: user.id },
        orderBy: { updatedAt: 'desc' },
      }),
    );
    return true;
  }
  if (!id && req.method === 'POST') {
    const body = await readBody(req);
    const contract = await prisma.accountContract.create({
      data: {
        userId: user.id,
        title: string(body.title, 'a contract title', 240, true),
        contractType: string(body.contractType, 'a contract type', 240, true),
        content: string(body.content, 'contract content', 200000, true),
        userRequest: body.userRequest
          ? string(body.userRequest, 'instructions', 12000)
          : null,
        selectedTemplateId:
          typeof body.selectedTemplateId === 'string'
            ? body.selectedTemplateId.slice(0, 240)
            : null,
        selectedTemplateSourceFile:
          typeof body.selectedTemplateSourceFile === 'string'
            ? body.selectedTemplateSourceFile.slice(0, 500)
            : null,
        wizardAnswers:
          body.wizardAnswers &&
          typeof body.wizardAnswers === 'object' &&
          !Array.isArray(body.wizardAnswers)
            ? body.wizardAnswers
            : {},
        ...(body.aiRecommendation
          ? { aiRecommendation: body.aiRecommendation }
          : {}),
      },
    });
    sendJson(res, 201, contract);
    return true;
  }
  const contract = await ownedAccountContract(user.id, id);
  if (req.method === 'GET' && !action) {
    sendJson(res, 200, contract);
    return true;
  }
  if (req.method === 'POST' && action === 'update') {
    const body = await readBody(req);
    const updated = await prisma.accountContract.update({
      where: { id: contract.id },
      data: {
        content: string(body.content, 'contract content', 200000, true),
        wizardAnswers: { ...contract.wizardAnswers, __manualContent: 'true' },
      },
    });
    await prisma.projectContract.updateMany({
      where: { accountContractId: id, project: { userId: user.id } },
      data: { title: updated.title },
    });
    sendJson(res, 200, updated);
    return true;
  }
  if (req.method === 'POST' && action === 'delete') {
    const progress = await prisma.contractProgress.findFirst({
      where: { accountContractId: id, userId: user.id },
      include: { signedCopies: true },
    });
    await prisma.$transaction([
      prisma.projectContract.deleteMany({
        where: { accountContractId: id, project: { userId: user.id } },
      }),
      prisma.contractProgress.deleteMany({
        where: { accountContractId: id, userId: user.id },
      }),
      prisma.accountContract.delete({ where: { id: contract.id } }),
    ]);
    if (progress) await cleanupSignedCopies(progress.signedCopies);
    sendJson(res, 200, { ok: true });
    return true;
  }
  throw fail('Contract endpoint not found.', 404);
}
