import { getConfig } from '../config';
import { getUploadQueue } from '../queue/upload.queue';
import { getRetryQueue } from '../queue/retry.queue';
import { getUploadWorker } from './upload.worker';
import { UploadJob } from '../types/upload.types';
import { BatchSummary } from '../types/upload.types';
import { getNotificationService } from '../services/notification.service';
import logger from '../utils/logger';

/**
 * REQ-4: Sequential Upload Processor
 *
 * This worker enforces a strict one-at-a-time upload policy:
 *   - Only one job is ever active at any point.
 *   - After every job (success OR failure), it waits UPLOAD_DELAY_SECONDS
 *     before starting the next one.
 *   - A boolean mutex (`isProcessing`) eliminates any possibility of a
 *     race condition — if a second signal arrives while one job is in
 *     progress, it is ignored; the loop naturally picks it up next.
 *
 * REQ-5: Failure Handling
 *   - A failed job is recorded + notified, but processing CONTINUES with
 *     the next queued video after the delay.
 *
 * REQ-8: Queue Recovery
 *   - On start(), any PENDING jobs left over from a previous run are
 *     processed automatically (server.ts resets stuck in-flight jobs first).
 *
 * REQ-6d: Batch Finished
 *   - When the last job in a batch completes, a summary notification is sent.
 */
export class DownloadWorker {
  private isStarted = false;

  /**
   * Global mutex — true while a job is being processed.
   * Prevents any possibility of two simultaneous uploads.
   */
  private isProcessing = false;

  /**
   * Starts the sequential upload processor.
   */
  start(): void {
    if (this.isStarted) {
      logger.warn('DownloadWorker already started');
      return;
    }

    this.isStarted = true;
    const queue = getUploadQueue();
    const retryQueue = getRetryQueue();

    // ── REQ-8: Process any pending jobs left from a previous run ────────────
    void this.triggerNextJob();

    // ── Listen for new jobs — only trigger if not already processing ─────────
    queue.on('job:added', () => {
      // The mutex guarantees that if we are already processing, this is a
      // no-op. The new job will be picked up naturally when the current
      // job finishes and the loop continues.
      void this.triggerNextJob();
    });

    // ── Retry queue: re-submit failed jobs back into the sequential loop ─────
    retryQueue.start((job: UploadJob, attempt: number) => {
      logger.info('Retry triggered for job — re-queuing into sequential processor', {
        jobId: job.id,
        attempt,
        fileName: job.driveFileName,
      });
      // The retry queue already reset the status to PENDING
      void this.triggerNextJob();
    });

    logger.info('DownloadWorker started — sequential mode with delay', {
      uploadDelaySeconds: getConfig().upload.uploadDelaySeconds,
    });
  }

  /**
   * Stops the worker and its retry queue.
   */
  stop(): void {
    this.isStarted = false;
    getRetryQueue().stop();
    logger.info('DownloadWorker stopped');
  }

  /**
   * Returns the active processing state.
   */
  isActive(): boolean {
    return this.isProcessing;
  }

  // ─── Core Sequential Loop ─────────────────────────────────────────────────

  /**
   * Main sequential processing loop.
   *
   * This is the single entry point for all job dispatching.
   * Multiple calls while a job is in progress are safe — they return
   * immediately without side effects thanks to the `isProcessing` mutex.
   */
  private async triggerNextJob(): Promise<void> {
    // ── Mutex guard: only one execution at a time ────────────────────────────
    if (this.isProcessing || !this.isStarted) {
      return;
    }

    const queue = getUploadQueue();
    const uploadWorker = getUploadWorker();

    // Collect batch-level stats across the entire run of the loop
    let batchSuccess = 0;
    let batchFailed = 0;
    const batchStart = Date.now();
    let batchTotalFound = 0;

    this.isProcessing = true;

    try {
      // ── Process jobs one at a time until the queue is empty ─────────────────
      let job: UploadJob | null;

      while ((job = await queue.dequeueNext()) !== null) {
        const currentJob = job; // capture for closure safety
        batchTotalFound++;

        const pendingBefore = await queue.countPending();

        logger.info('Sequential processor: starting job', {
          jobId: currentJob.id,
          fileName: currentJob.driveFileName,
          queuePosition: batchTotalFound,
          remainingAfter: pendingBefore,
        });

        const config = getConfig();
        const accountId = currentJob.instagramAccountId ?? config.instagram.accountId;
        const account = config.accounts.find((a) => a.instagramAccountId === accountId);

        // ── REQ-6a: Notify Upload Started ──────────────────────────────────
        const notificationService = getNotificationService();
        await notificationService.notifyUploadStarted({
          fileName: currentJob.driveFileName,
          queuePosition: batchTotalFound,
          totalInQueue: batchTotalFound + pendingBefore,
          startTime: new Date(),
          accountId: currentJob.instagramAccountId ?? undefined,
          proxyUrl: account?.proxyUrl,
        });

        let processResult: { success: boolean; restrictAccount?: boolean } = { success: false };
        try {
          processResult = await uploadWorker.processJob(currentJob);
        } catch (unexpectedError) {
          // This should never happen — processJob() has its own try/catch.
          // Belt-and-suspenders: log and continue regardless.
          logger.error('Unexpected error from uploadWorker.processJob', {
            jobId: currentJob.id,
            error:
              unexpectedError instanceof Error ? unexpectedError.message : String(unexpectedError),
          });
        } finally {
          queue.release(currentJob.id);
        }

        if (processResult.success) {
          batchSuccess++;
        } else {
          batchFailed++;

          if (processResult.restrictAccount && currentJob.instagramAccountId) {
            logger.warn(
              'Account is restricted by Meta API — skipping retries and canceling pending jobs',
              {
                jobId: currentJob.id,
                accountId: currentJob.instagramAccountId,
              },
            );
            await queue.cancelJobsForAccount(
              currentJob.instagramAccountId,
              'Account restricted by Meta API',
            );
          } else if (currentJob.retryCount < getConfig().upload.maxRetryAttempts) {
            // REQ-5: Schedule retry if under the limit; continue either way
            await getRetryQueue().addForRetry(currentJob);
          } else {
            logger.warn('Job exceeded max retry attempts — skipping permanently', {
              jobId: currentJob.id,
              fileName: currentJob.driveFileName,
              retryCount: currentJob.retryCount,
            });
          }
        }

        // ── REQ-4: Wait between uploads ─────────────────────────────────────
        const hasMore = (await queue.countPending()) > 0;

        if (hasMore) {
          const delayMs = getConfig().upload.uploadDelaySeconds * 1000;
          logger.info(
            `Sequential processor: waiting ${getConfig().upload.uploadDelaySeconds}s before next upload`,
            {
              delayMs,
            },
          );
          await this.sleep(delayMs);
        }
      }

      // ── REQ-6d: Batch Finished notification ──────────────────────────────
      if (batchTotalFound > 0) {
        const summary: BatchSummary = {
          totalFound: batchTotalFound,
          totalSuccess: batchSuccess,
          totalFailed: batchFailed,
          totalSkipped: 0, // scheduler handles skip detection before enqueue
          totalProcessingMs: Date.now() - batchStart,
        };

        logger.info('Sequential processor: batch complete', summary);

        const notificationService = getNotificationService();
        await notificationService.notifyBatchFinished(summary);
      }
    } finally {
      // Always release the mutex, even if something unexpected throws above
      this.isProcessing = false;
      logger.debug('Sequential processor: mutex released');
    }
  }

  /**
   * Returns the number of currently running upload jobs (0 or 1).
   */
  getActiveCount(): number {
    return this.isProcessing ? 1 : 0;
  }

  /**
   * Promisified sleep helper.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Singleton
let downloadWorker: DownloadWorker | null = null;

export function getDownloadWorker(): DownloadWorker {
  if (!downloadWorker) {
    downloadWorker = new DownloadWorker();
  }
  return downloadWorker;
}
