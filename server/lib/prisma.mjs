import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis;

export const prisma = globalForPrisma.__ownMastersPrismaClient ?? new PrismaClient({
  log: process.env.NODE_ENV === 'production' ? ['error'] : ['warn', 'error'],
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__ownMastersPrismaClient = prisma;
}
