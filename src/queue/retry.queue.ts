import { UploadJob } from '../types/upload.types';
import { UploadJobModel } from '../database/repository';
import { getConfig } from '../config';
import logger from '../utils/logger';

interface RetryEntry {
  job: UploadJob;
  nextRetryAt: Date;
  attempt: number;
}

/**
 * Queue for managing failed upload retries with exponential backoff.
 * Failed jobs are re-queued after a delay, up to maxRetryAttempts.
 */
export class RetryQueue {
  private retryEntries: RetryEntry[] = [];
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private readonly config = getConfig();

  /**
   * Adds a failed job to the retry queue with exponential backoff.
   */
  async addForRetry(job: UploadJob): Promise<void> {
    const nextAttempt = job.retryCount + 1;

    if (nextAttempt > this.config.upload.maxRetryAttempts) {
      logger.warn('Job exceeded max retry attempts, marking as FAILED', {
        jobId: job.id,
        fileName: job.driveFileName,
        attempts: job.retryCount,
      });

      await UploadJobModel.update(job.id, {
        status: 'FAILED',
        errorMessage: `Exceeded max retry attempts (${this.config.upload.maxRetryAttempts})`,
      });

      return;
    }

    const delayMs = this.config.upload.retryBaseDelayMs * Math.pow(2, job.retryCount);
    const nextRetryAt = new Date(Date.now() + delayMs);

    this.retryEntries.push({ job, nextRetryAt, attempt: nextAttempt });

    logger.info('Job queued for retry', {
      jobId: job.id,
      fileName: job.driveFileName,
      attempt: nextAttempt,
      retryAt: nextRetryAt.toISOString(),
      delayMs,
    });
  }

  /**
   * Starts the retry processor that runs every 10 seconds.
   */
  start(onRetry: (job: UploadJob, attempt: number) => void): void {
    this.intervalHandle = setInterval(() => {
      this.processRetries(onRetry).catch((err: unknown) => {
        logger.error('Error in retry processor', { error: err });
      });
    }, 10_000);

    logger.info('Retry queue started');
  }

  /**
   * Stops the retry processor.
   */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      logger.info('Retry queue stopped');
    }
  }

  /**
   * Processes all entries whose retry time has arrived.
   */
  private async processRetries(onRetry: (job: UploadJob, attempt: number) => void): Promise<void> {
    const now = new Date();
    const ready = this.retryEntries.filter((e) => e.nextRetryAt <= now);
    if (ready.length === 0) return;

    this.retryEntries = this.retryEntries.filter((e) => e.nextRetryAt > now);

    const healthService = (await import('../services/health.service')).getHealthService();

    for (const entry of ready) {
      const accountId = entry.job.instagramAccountId;
      if (accountId && (await healthService.checkCooldown(accountId))) {
        // Skip, but we must put it back into the queue!
        entry.nextRetryAt = new Date(Date.now() + 60 * 1000); // Check again in 60 seconds
        this.retryEntries.push(entry);
        continue;
      }
      // Update retry count in DB
      await UploadJobModel.update(entry.job.id, {
        status: 'PENDING',
        retryCount: entry.attempt,
      });

      const updatedJob: UploadJob = {
        ...entry.job,
        status: 'PENDING',
        retryCount: entry.attempt,
      };

      logger.info('Retrying job', {
        jobId: entry.job.id,
        fileName: entry.job.driveFileName,
        attempt: entry.attempt,
      });

      onRetry(updatedJob, entry.attempt);
    }
  }

  /**
   * Returns the number of jobs waiting for retry.
   */
  getPendingCount(): number {
    return this.retryEntries.length;
  }
}

// Singleton
let retryQueue: RetryQueue | null = null;

export function getRetryQueue(): RetryQueue {
  if (!retryQueue) {
    retryQueue = new RetryQueue();
  }
  return retryQueue;
}
