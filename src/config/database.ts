import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger';
import { getConfig } from './index';

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
  const config = getConfig();

  let resetCount = 0;

  // 1. Reset jobs that were actively processing when server crashed
  const inFlightResult = await db.uploadJob.updateMany({
    where: {
      status: { in: inFlightStatuses },
    },
    data: {
      status: 'PENDING',
      processingAt: null,
    },
  });
  resetCount += inFlightResult.count;

  // 2. Recovery for in-memory Retry Queue:
  // If the server crashed, any FAILED job waiting for backoff timer in memory is lost.
  // We reset them to PENDING so they are re-queued immediately on boot.
  const failedResult = await db.uploadJob.updateMany({
    where: {
      status: 'FAILED',
      retryCount: {
        lt: config.upload.maxRetryAttempts,
      },
    },
    data: {
      status: 'PENDING',
      processingAt: null,
    },
  });
  resetCount += failedResult.count;

  if (resetCount > 0) {
    logger.warn(`Queue recovery: reset ${resetCount} stuck/failed job(s) to PENDING`);
  }

  return resetCount;
}
