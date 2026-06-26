import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger';

let prisma: PrismaClient | null = null;

/**
 * Returns the singleton Prisma database connection.
 */
export function getDatabase(): PrismaClient {
  if (prisma) return prisma;

  prisma = new PrismaClient({
    log: ['query', 'info', 'warn', 'error'],
  });

  logger.info('Prisma Postgres database initialized');

  return prisma;
}

/**
 * Closes the database connection gracefully.
 */
export async function closeDatabase(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
    logger.info('Prisma database connection closed');
  }
}

/**
 * REQ-8: Queue Recovery
 * Resets any jobs that were stuck in-flight when the server last crashed.
 */
export async function recoverStuckJobs(): Promise<number> {
  const db = getDatabase();
  const inFlightStatuses = ['DOWNLOADING', 'UPLOADING', 'PROCESSING', 'PUBLISHING'];

  const result = await db.uploadJob.updateMany({
    where: {
      status: {
        in: inFlightStatuses,
      },
    },
    data: {
      status: 'PENDING',
    },
  });

  if (result.count > 0) {
    logger.warn(`Queue recovery: reset ${result.count} stuck in-flight job(s) to PENDING`);
  }

  return result.count;
}
