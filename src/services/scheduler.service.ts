import cron, { ScheduledTask } from 'node-cron';
import { getConfig } from '../config';
import logger from '../utils/logger';
import { getUploadQueue } from '../queue/upload.queue';
import { getDriveService } from './google-drive.service';
import { ProcessedFileModel, UploadLogModel } from '../database/repository';
import { getNotificationService } from './notification.service';

/**
 * Scheduler service that periodically polls Google Drive for new videos
 * and enqueues them for upload.
 *
 * Guards:
 *  - Daily upload limit per account (DAILY_UPLOAD_LIMIT env var)
 *  - Same filename already uploaded today for this account → skip until tomorrow
 *  - Large queue warning when queue exceeds LARGE_QUEUE_WARNING_THRESHOLD
 *  - Token expiry warning (TOKEN_EXPIRY_DATE) — checked daily at 9 AM IST
 *  - Daily summary at midnight IST (18:30 UTC)
 */
export class SchedulerService {
  private task: ScheduledTask | null = null;
  private dailySummaryTask: ScheduledTask | null = null;
  private tokenExpiryTask: ScheduledTask | null = null;
  private isRunning = false;
  private largeQueueWarned = false; // Prevents spamming the large-queue warning
  private readonly config = getConfig();

  /**
   * Starts the cron-based polling scheduler.
   */
  start(): void {
    const cronExpression = this.config.upload.pollingCron;

    if (!cronExpression || cronExpression.toLowerCase() === 'false') {
      logger.info('Internal polling cron is disabled. Relying on external triggers (e.g. n8n).');
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

    // Main Drive polling task
    this.task = cron.schedule(cronExpression, () => {
      void this.runPollCycle();
    });

    // Daily summary at midnight IST (18:30 UTC)
    this.dailySummaryTask = cron.schedule('30 18 * * *', () => {
      void getNotificationService().notifyDailySummary();
      logger.info('Daily summary notification sent');
    });

    // Token expiry check every morning at 9 AM IST (3:30 UTC)
    this.tokenExpiryTask = cron.schedule('30 3 * * *', () => {
      void this.checkTokenExpiry();
    });

    logger.info('Scheduler started', { cron: cronExpression });

    // Run immediately on startup
    void this.runPollCycle();
    void this.checkTokenExpiry();
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
    if (this.dailySummaryTask) {
      this.dailySummaryTask.stop();
      this.dailySummaryTask = null;
    }
    if (this.tokenExpiryTask) {
      this.tokenExpiryTask.stop();
      this.tokenExpiryTask = null;
    }
  }

  /**
   * Returns whether the scheduler is currently active.
   */
  isActive(): boolean {
    return this.task !== null;
  }

  /**
   * Checks if the Graph API token is expiring soon and sends a Telegram warning.
   */
  private async checkTokenExpiry(): Promise<void> {
    const expiryDate = this.config.instagram.tokenExpiryDate;
    if (!expiryDate) return;

    try {
      const expiry = new Date(expiryDate);
      const today = new Date();
      const daysLeft = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      if (daysLeft <= 10 && daysLeft > 0) {
        logger.warn('Graph API token expiring soon', { daysLeft, expiryDate });
        await getNotificationService().notifyTokenExpirySoon(daysLeft, expiryDate);
      } else if (daysLeft <= 0) {
        logger.error('Graph API token has already expired!', { expiryDate });
        await getNotificationService().notifyTokenExpirySoon(0, expiryDate);
      }
    } catch (err) {
      logger.warn('Could not check token expiry', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  /**
   * Runs a single poll cycle:
   * 1. Lists new MP4 files from Drive
   * 2. Applies daily limit, same-day duplicate, and already-processed guards
   * 3. Enqueues new files for upload
   * 4. Warns if queue is unusually large
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
      const accounts = this.config.accounts;
      const dailyLimit = this.config.upload.dailyUploadLimit; // 0 = unlimited
      const queueWarningThreshold = this.config.upload.largeQueueWarningThreshold;

      let totalEnqueued = 0;
      let totalSkipped = 0;

      for (const account of accounts) {
        if (!account.driveFolderId) continue;

        const files = await driveService.listVideoFiles({ folderId: account.driveFolderId });

        if (files.length === 0) {
          logger.info('No new video files found in Drive folder', { folderId: account.driveFolderId });
          continue;
        }

        const queue = getUploadQueue();
        let enqueued = 0;
        let skipped = 0;

        // ── Daily limit check ──────────────────────────────────────────────
        if (dailyLimit > 0) {
          const uploadedToday = await UploadLogModel.countTodaySuccessByAccount(account.instagramAccountId);
          if (uploadedToday >= dailyLimit) {
            logger.info('Daily upload limit reached for account — skipping all files', {
              account: account.accountName ?? account.instagramAccountId,
              uploadedToday,
              dailyLimit,
            });
            await getNotificationService().notifyDailyLimitReached(
              account.accountName ?? account.instagramAccountId,
              account.instagramAccountId,
              dailyLimit,
            );
            totalSkipped += files.length;
            continue;
          }
        }

        for (const file of files) {
          // ── Guard 1: Already permanently processed (Drive file ID match) ──
          if (await ProcessedFileModel.isProcessed(file.id)) {
            logger.debug('Skipping already processed file', { fileId: file.id, name: file.name });
            skipped++;
            continue;
          }

          // ── Guard 2: Same filename already uploaded today for this account ──
          // This allows the same video to be re-uploaded on a different day,
          // but prevents duplicate uploads within the same day.
          if (await UploadLogModel.wasUploadedTodayByName(file.name, account.instagramAccountId)) {
            logger.info('Skipping file — same filename already uploaded today for this account', {
              fileName: file.name,
              accountId: account.instagramAccountId,
            });
            skipped++;
            continue;
          }

          // ── Guard 3: Already in the queue ─────────────────────────────────
          if (await queue.isProcessing(file.id)) {
            logger.debug('File already in queue', { fileId: file.id, name: file.name });
            skipped++;
            continue;
          }

          // ── Enforce per-account daily limit mid-batch ──────────────────────
          if (dailyLimit > 0) {
            const uploadedToday = await UploadLogModel.countTodaySuccessByAccount(account.instagramAccountId);
            const inQueue = await queue.countPendingForAccount(account.instagramAccountId);
            if (uploadedToday + inQueue >= dailyLimit) {
              logger.info('Daily limit will be reached — stopping enqueue for account', {
                account: account.accountName ?? account.instagramAccountId,
                uploadedToday,
                inQueue,
                dailyLimit,
              });
              skipped++;
              continue;
            }
          }

          // ── Enqueue ────────────────────────────────────────────────────────
          const job = await queue.enqueue(file, account.instagramAccountId, account.driveUploadedFolderId);
          if (job) {
            enqueued++;
            logger.info('Enqueued file for upload', {
              fileId: file.id,
              name: file.name,
              accountId: account.instagramAccountId,
            });
          } else {
            skipped++;
          }
        }

        totalEnqueued += enqueued;
        totalSkipped += skipped;

        logger.info('Poll cycle complete for folder', {
          folderId: account.driveFolderId,
          total: files.length,
          enqueued,
          skipped,
        });
      }

      // ── Large queue warning ────────────────────────────────────────────────
      if (queueWarningThreshold > 0) {
        const queue = getUploadQueue();
        const stats = await queue.getStats();
        const totalPending = stats.pending;

        if (totalPending >= queueWarningThreshold && !this.largeQueueWarned) {
          this.largeQueueWarned = true;
          logger.warn('Large upload queue detected', { totalPending, queueWarningThreshold });
          await getNotificationService().notifyLargeQueue(totalPending, queueWarningThreshold);
        } else if (totalPending < queueWarningThreshold) {
          // Reset so we can warn again if it fills up again
          this.largeQueueWarned = false;
        }
      }

      logger.info('Overall poll cycle complete', { totalEnqueued, totalSkipped });

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
