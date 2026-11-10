import { loadEnv } from '../../server/lib/env.mjs';
import { prisma } from '../../server/lib/prisma.mjs';

loadEnv();

console.log('This will clear ONLY contract-related database tables.');
console.log('It will delete GeneratedContract rows and ContractTemplate rows.');
console.log('It will NOT delete your ZIP file or storage folders.');

await prisma.generatedContract.deleteMany({});
await prisma.contractTemplate.deleteMany({});

console.log('Done. Contract database tables are now clean.');
await prisma.$disconnect();