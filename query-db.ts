import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const count = await prisma.uploadJob.count();
  console.log('Total jobs in DB:', count);
  const jobs = await prisma.uploadJob.findMany({ select: { id: true, driveFileName: true, status: true }, take: 5 });
  console.log(jobs);
}
main().finally(() => prisma.$disconnect());
