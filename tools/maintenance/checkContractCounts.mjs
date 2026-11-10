import { loadEnv } from '../../server/lib/env.mjs';
import { prisma } from '../../server/lib/prisma.mjs';

loadEnv();

const counts = await prisma.contractTemplate.groupBy({
  by: ['aiScanStatus'],
  _count: {
    _all: true,
  },
});

console.log(counts);

await prisma.$disconnect();
