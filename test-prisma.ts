import { db } from './db.js';

async function test() {
  try {
    console.log('Testing Prisma connection...');
    const result = await db.$queryRaw`SELECT 1 as test`;
    console.log('Prisma connection OK:', result);
    process.exit(0);
  } catch (error) {
    console.error('Prisma error:', error);
    process.exit(1);
  }
}

test();
