import { loadEnv } from '../lib/env.mjs';
import { prisma } from '../lib/prisma.mjs';

loadEnv();

const counts = await prisma.contractTemplate.groupBy({
  by: ['aiScanStatus'],
  _count: {
    _all: true,
  },
});

console.log(counts);

await prisma.$disconnect();
