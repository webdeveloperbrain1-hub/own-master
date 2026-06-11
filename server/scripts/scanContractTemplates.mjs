import { loadEnv } from '../lib/env.mjs';
import { prisma } from '../lib/prisma.mjs';
import { scanContractTemplate } from '../lib/contracts/scanContractTemplateService.mjs';

loadEnv();

const args = process.argv.slice(2);

const force = args.includes('--force');

const limitArg = args.find((arg) => arg.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : undefined;

if (limitArg && (!Number.isFinite(limit) || limit <= 0)) {
  console.error(`Invalid --limit value: ${limitArg}`);
  process.exit(1);
}

const templates = await prisma.contractTemplate.findMany({
  where: force ? {} : { aiScanStatus: { in: ['not_scanned', 'failed'] } },
  orderBy: { createdAt: 'asc' },
  take: limit,
});

console.log(
  `Scanning ${templates.length} contract template(s)` +
    `${force ? ' with --force' : ''}` +
    `${limit ? ` with --limit=${limit}` : ''}.`
);

let success = 0;
let failed = 0;

for (const [index, template] of templates.entries()) {
  process.stdout.write(`[${index + 1}/${templates.length}] ${template.name}... `);

  try {
    const result = await scanContractTemplate(template.id);
    success += 1;
    console.log(result.aiScanStatus);
  } catch (error) {
    failed += 1;
    console.log(`failed: ${error.message}`);
  }
}

console.log(`Done. Successful: ${success}. Failed: ${failed}.`);
await prisma.$disconnect();