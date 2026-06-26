import cron, { ScheduledTask } from 'node-cron';
import { getConfig } from '../config';
import logger from '../utils/logger';
import { getUploadQueue } from '../queue/upload.queue';
import { getDriveService } from './google-drive.service';
import { ProcessedFileModel, UploadJobModel } from '../database/repository';

/**
 * Scheduler service that periodically polls Google Drive for new videos
 * and enqueues them for upload.
 */
export class SchedulerService {
  private task: ScheduledTask | null = null;
  private isRunning = false;
  private readonly config = getConfig();

  /**
   * Starts the cron-based polling scheduler.
   */
  start(): void {
    const cronExpression = this.config.upload.pollingCron;

    if (!cronExpression || cronExpression.toLowerCase() === 'false') {
      logger.info('Internal polling cron is disabled. Relying on external triggers (e.g. n8n).');
      // We don't start the interval, but we still run once on startup
      void this.runPollCycle();
      return;
    }

    if (!cron.validate(cronExpression)) {
      throw new Error(`Invalid cron expression: ${cronExpression}`);
    }

    if (this.task) {
      logger.warn('Scheduler already running. Stop it before starting again.');
      return;
    }

    this.task = cron.schedule(cronExpression, () => {
      void this.runPollCycle();
    });

    logger.info('Scheduler started', { cron: cronExpression });

    // Run immediately on startup
    void this.runPollCycle();
  }

  /**
   * Stops the cron scheduler.
   */
  stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
      logger.info('Scheduler stopped');
    }
  }

  /**
   * Returns whether the scheduler is currently active.
   */
  isActive(): boolean {
    return this.task !== null;
  }

  /**
   * Runs a single poll cycle:
   * 1. Lists new MP4 files from Drive
   * 2. Filters already-processed and already-queued files
   * 3. Enqueues new files for upload
   */
  async runPollCycle(): Promise<void> {
    if (this.isRunning) {
      logger.debug('Poll cycle already in progress, skipping');
      return;
    }

    this.isRunning = true;
    logger.info('Starting Drive poll cycle');

    try {
      const driveService = getDriveService();
      const files = await driveService.listVideoFiles();

      if (files.length === 0) {
        logger.info('No new video files found in Drive folder');
        return;
      }

      const queue = getUploadQueue();
      let enqueued = 0;
      let skipped = 0;

      for (const file of files) {
        // Skip already processed files
        if (await ProcessedFileModel.isProcessed(file.id)) {
          logger.debug('Skipping already processed file', { fileId: file.id, name: file.name });
          skipped++;
          continue;
        }

        // Skip files that already have a job record
        if (await UploadJobModel.hasJob(file.id)) {
          logger.debug('Skipping file with existing job', { fileId: file.id, name: file.name });
          skipped++;
          continue;
        }

        // Enqueue the file
        await queue.enqueue(file);
        enqueued++;
        logger.info('Enqueued file for upload', { fileId: file.id, name: file.name });
      }

      logger.info('Poll cycle complete', {
        total: files.length,
        enqueued,
        skipped,
      });
    } catch (error) {
      logger.error('Drive poll cycle failed', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    } finally {
      this.isRunning = false;
    }
  }
}

// Singleton
let schedulerService: SchedulerService | null = null;

export function getSchedulerService(): SchedulerService {
  if (!schedulerService) {
    schedulerService = new SchedulerService();
  }
  return schedulerService;
}
