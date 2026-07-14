import EventEmitter from 'events';
import { DriveFile } from '../types/drive.types';
import { UploadJob, QueueStats } from '../types/upload.types';
import { UploadJobModel, ProcessedFileModel } from '../database/repository';
import { getDatabase } from '../config/database';
import logger from '../utils/logger';

/**
 * In-memory upload queue backed by PostgreSQL (Prisma) for persistence.
 * Emits 'job:added' events for the worker to pick up.
 */
export class UploadQueue extends EventEmitter {
  private processingSet = new Set<string>();

  /**
   * Adds a Drive file to the upload queue.
   * Prevents duplicates via the processedFiles table and active job check.
   */
  async enqueue(
    driveFile: DriveFile,
    instagramAccountId: string,
    uploadedDriveFolderId: string,
  ): Promise<UploadJob | null> {
    // Double-check for duplicates
    if (await ProcessedFileModel.isProcessed(driveFile.id)) {
      logger.debug('File already processed, not enqueuing', { fileId: driveFile.id });
      return null;
    }

    if (await UploadJobModel.hasJob(driveFile.id)) {
      logger.debug('File already has a job, not enqueuing', { fileId: driveFile.id });
      return null;
    }

    const job = await UploadJobModel.createSafe({
      driveFileId: driveFile.id,
      driveFileName: driveFile.name,
      status: 'PENDING',
      instagramAccountId,
      uploadedDriveFolderId,
    });

    if (!job) {
      logger.debug('Job insertion failed (unique constraint), duplicate prevented', {
        fileId: driveFile.id,
      });
      return null;
    }

    logger.info('Job added to queue', { jobId: job.id, fileName: driveFile.name });
    this.emit('job:added', job);

    return job;
  }

  /**
   * Manually enqueues a job by Drive file ID (for API-triggered uploads).
   */
  async enqueueById(
    driveFileId: string,
    driveFileName: string,
    instagramAccountId: string,
    uploadedDriveFolderId: string,
  ): Promise<UploadJob> {
    const job = await UploadJobModel.createSafe({
      driveFileId,
      driveFileName,
      status: 'PENDING',
      instagramAccountId,
      uploadedDriveFolderId,
    });

    if (!job) {
      throw new Error(`Job for file ${driveFileId} is already in the queue or processed.`);
    }

    logger.info('Job manually enqueued', { jobId: job.id, driveFileId, driveFileName });
    this.emit('job:added', job);

    return job;
  }

  /**
   * Returns the next PENDING job from the database queue.
   */
  async dequeue(): Promise<UploadJob | null> {
    const pendingJobs = await UploadJobModel.findByStatus('PENDING');
    const nextJob = pendingJobs.find((j) => !this.processingSet.has(j.id));

    if (!nextJob) return null;

    this.processingSet.add(nextJob.id);
    return nextJob;
  }

  /**
   * Marks a job as no longer actively processing in memory.
   */
  release(jobId: string): void {
    this.processingSet.delete(jobId);
  }

  /**
   * Returns current queue statistics.
   */
  async getStats(): Promise<QueueStats> {
    return UploadJobModel.getStats();
  }

  /**
   * Returns all pending jobs.
   */
  async getPendingJobs(): Promise<UploadJob[]> {
    return UploadJobModel.findByStatus('PENDING');
  }

  /**
   * Checks if a specific Drive file is currently being processed.
   */
  async isProcessing(driveFileId: string): Promise<boolean> {
    const [downloading, uploading, processing, publishing] = await Promise.all([
      UploadJobModel.findByStatus('DOWNLOADING'),
      UploadJobModel.findByStatus('UPLOADING'),
      UploadJobModel.findByStatus('PROCESSING'),
      UploadJobModel.findByStatus('PUBLISHING'),
    ]);

    const processingJobs = [...downloading, ...uploading, ...processing, ...publishing];
    return processingJobs.some((j) => j.driveFileId === driveFileId);
  }

  /**
   * Dequeues the next PENDING job and locks it in the in-memory processing set.
   * Returns null if the queue is empty or all pending jobs are already locked.
   * This is the primary API used by the sequential processor's while-loop.
   */
  async dequeueNext(): Promise<UploadJob | null> {
    const pendingJobs = await UploadJobModel.findByStatus('PENDING');
    const availableJobs = pendingJobs.filter((j) => !this.processingSet.has(j.id));

    if (availableJobs.length === 0) return null;

    const healthService = (await import('../services/health.service')).getHealthService();

    // Group jobs by account so they don't interleave
    availableJobs.sort((a, b) => {
      const accountA = a.instagramAccountId || '';
      const accountB = b.instagramAccountId || '';
      const accountCompare = accountA.localeCompare(accountB);
      if (accountCompare !== 0) return accountCompare;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    for (const nextJob of availableJobs) {
      const accountId = nextJob.instagramAccountId;
      if (accountId && (await healthService.checkCooldown(accountId))) {
        continue;
      }
      this.processingSet.add(nextJob.id);
      return nextJob;
    }
    
    return null;
  }

  async countPending(): Promise<number> {
    const processingArray = Array.from(this.processingSet);
    return getDatabase().uploadJob.count({
      where: {
        status: 'PENDING',
        id: { notIn: processingArray },
      },
    });
  }

  /**
   * Returns the count of PENDING jobs for a specific Instagram account.
   * Used by the daily limit guard to avoid over-enqueuing.
   */
  async countPendingForAccount(instagramAccountId: string): Promise<number> {
    return getDatabase().uploadJob.count({
      where: {
        status: { in: ['PENDING', 'DOWNLOADING', 'UPLOADING', 'PROCESSING', 'PUBLISHING'] },
        instagramAccountId,
      },
    });
  }

  /**
   * Cancels all pending jobs for a specific account.
   * This is useful when an account hits rate limits or gets restricted.
   */
  async cancelJobsForAccount(accountId: string, reason: string): Promise<number> {
    const pendingJobs = await UploadJobModel.findByStatus('PENDING');
    const jobsToCancel = pendingJobs.filter(
      (j) => j.instagramAccountId === accountId && !this.processingSet.has(j.id),
    );

    let canceledCount = 0;
    for (const job of jobsToCancel) {
      await UploadJobModel.update(job.id, {
        status: 'FAILED',
        errorMessage: reason,
      });
      canceledCount++;
    }

    if (canceledCount > 0) {
      logger.warn('Canceled pending jobs for restricted account', {
        accountId,
        canceledCount,
        reason,
      });
    }

    return canceledCount;
  }
}

// Singleton
let uploadQueue: UploadQueue | null = null;

export function getUploadQueue(): UploadQueue {
  if (!uploadQueue) {
    uploadQueue = new UploadQueue();
  }
  return uploadQueue;
}
