import { loadEnv } from '../lib/env.mjs';
import { prisma } from '../lib/prisma.mjs';

loadEnv();

const result = await prisma.contractTemplate.updateMany({
  where: {
    aiScanStatus: 'needs_review',
  },
  data: {
    aiScanStatus: 'not_scanned',
    extractedText: null,
    textQuality: null,
    fieldSchema: null,
    warnings: null,
    scanError: null,
    approved: false,
  },
});

console.log(`Reset ${result.count} needs_review contract(s) back to not_scanned.`);

await prisma.$disconnect();