import EventEmitter from 'events';
import { DriveFile } from '../types/drive.types';
import { UploadJob, QueueStats } from '../types/upload.types';
import { UploadJobModel, ProcessedFileModel } from '../database/repository';
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
  async enqueue(driveFile: DriveFile): Promise<UploadJob | null> {
    // Double-check for duplicates
    if (await ProcessedFileModel.isProcessed(driveFile.id)) {
      logger.debug('File already processed, not enqueuing', { fileId: driveFile.id });
      return null;
    }

    if (await UploadJobModel.hasJob(driveFile.id)) {
      logger.debug('File already has a job, not enqueuing', { fileId: driveFile.id });
      return null;
    }

    const job = await UploadJobModel.create({
      driveFileId: driveFile.id,
      driveFileName: driveFile.name,
      status: 'PENDING',
    });

    logger.info('Job added to queue', { jobId: job.id, fileName: driveFile.name });
    this.emit('job:added', job);

    return job;
  }

  /**
   * Manually enqueues a job by Drive file ID (for API-triggered uploads).
   */
  async enqueueById(driveFileId: string, driveFileName: string): Promise<UploadJob> {
    const job = await UploadJobModel.create({
      driveFileId,
      driveFileName,
      status: 'PENDING',
    });

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
    const nextJob = pendingJobs.find((j) => !this.processingSet.has(j.id));

    if (!nextJob) return null;

    this.processingSet.add(nextJob.id);
    return nextJob;
  }

  /**
   * Returns the count of PENDING jobs not currently locked in processingSet.
   * Used by the sequential processor to decide whether to apply the delay.
   */
  async countPending(): Promise<number> {
    const pendingJobs = await UploadJobModel.findByStatus('PENDING');
    return pendingJobs.filter((j) => !this.processingSet.has(j.id)).length;
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
