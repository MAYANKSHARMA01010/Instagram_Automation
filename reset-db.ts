import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Resetting database...');
  await prisma.uploadLog.deleteMany();
  await prisma.uploadJob.deleteMany();
  console.log('Successfully deleted all records from uploadLog and uploadJob tables. Database is reset!');
}

main()
  .catch((e) => {
    console.error('Error resetting database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
