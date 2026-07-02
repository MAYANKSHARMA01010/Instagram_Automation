import cron, { ScheduledTask } from 'node-cron';
import { getConfig } from '../config';
import logger from '../utils/logger';
import { getUploadQueue } from '../queue/upload.queue';
import { getDriveService } from './google-drive.service';
import { ProcessedFileModel, UploadLogModel } from '../database/repository';
import { getNotificationService } from './notification.service';
import { getHealthService } from './health.service';
import { calculateWarmupDay, getWarmupLimit } from '../utils/warmup.util';
import { differenceInMinutes, parse, startOfDay, addMinutes } from 'date-fns';

export class SchedulerService {
  private task: ScheduledTask | null = null;
  private dailySummaryTask: ScheduledTask | null = null;
  private tokenExpiryTask: ScheduledTask | null = null;
  private isRunning = false;
  private largeQueueWarned = false; // Prevents spamming the large-queue warning
  private readonly config = getConfig();

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

    this.task = cron.schedule(cronExpression, () => {
      void this.runPollCycle();
    });

    this.dailySummaryTask = cron.schedule('30 18 * * *', () => {
      void getNotificationService().notifyDailySummary();
      logger.info('Daily summary notification sent');
    });

    this.tokenExpiryTask = cron.schedule('30 3 * * *', () => {
      void this.checkTokenExpiry();
    });

    logger.info('Scheduler started', { cron: cronExpression });
    void this.runPollCycle();
    void this.checkTokenExpiry();
  }

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

  isActive(): boolean {
    return this.task !== null;
  }

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
      logger.warn('Could not check token expiry', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

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
      const queueWarningThreshold = this.config.upload.largeQueueWarningThreshold;
      const healthService = getHealthService();
      const queue = getUploadQueue();

      let totalEnqueued = 0;
      let totalSkipped = 0;

      for (const account of accounts) {
        if (!account.driveFolderId) continue;

        const accountId = account.instagramAccountId;

        // ── 1. Check Cooldown ──
        if (
          this.config.upload.enableHealthScoring &&
          (await healthService.checkCooldown(accountId))
        ) {
          logger.info('Account is in cooldown, skipping poll', { accountId });
          continue;
        }

        // ── 2. Calculate Today's Limit ──
        let todayLimit = this.config.upload.dailyUploadLimit; // Global fallback
        let isAdaptiveEnabled = this.config.upload.enableAdaptiveWarmup;
        if (account.enableAdaptiveWarmup !== undefined) {
          isAdaptiveEnabled = account.enableAdaptiveWarmup;
        }

        if (account.enableWarmup || account.isNewAccount) {
          const targetLimit = account.targetDailyLimit ?? this.config.upload.targetDailyLimit;
          const day = calculateWarmupDay(account.warmupStartDate);
          let baseLimit = getWarmupLimit(day, targetLimit);

          if (isAdaptiveEnabled && this.config.upload.enableHealthScoring) {
            const health = await healthService.getHealth(accountId);
            const band = healthService.getHealthBand(health.healthScore);

            if (health.healthScore < 50) {
              // Post-cooldown or critical recovery: strictly clamp limit to 25%
              baseLimit = Math.max(1, Math.floor(baseLimit * 0.25));
            } else if (band === 'Danger') {
              baseLimit = Math.max(1, Math.floor(baseLimit * 0.75));
            } else if (band === 'Caution') {
              const yesterday = Math.max(1, day - 1);
              baseLimit = getWarmupLimit(yesterday, targetLimit);
            }
          }
          todayLimit = baseLimit;

          // The strict global daily limit always overrides the target warm-up limit if set lower.
          if (this.config.upload.dailyUploadLimit > 0) {
            todayLimit = Math.min(todayLimit, this.config.upload.dailyUploadLimit);
          }
        }

        // ── 3. Calculate Distribution (Pacing) ──
        const windowStartStr =
          account.postingWindowStart ?? this.config.upload.postingWindowStart ?? '00:00';
        const windowEndStr =
          account.postingWindowEnd ?? this.config.upload.postingWindowEnd ?? '23:59';

        const now = new Date();
        const todayStart = startOfDay(now);

        let windowStart = parse(windowStartStr, 'HH:mm', todayStart);
        let windowEnd = parse(windowEndStr, 'HH:mm', todayStart);

        // If window crosses midnight (e.g. 20:00 to 08:00)
        if (windowEnd <= windowStart) {
          if (now < windowEnd) {
            // We are in the morning hours (e.g. 02:00). The window actually started yesterday.
            windowStart = addMinutes(windowStart, -24 * 60);
          } else {
            // We are in the evening hours (e.g. 22:00). The window ends tomorrow.
            windowEnd = addMinutes(windowEnd, 24 * 60);
          }
        }

        let expectedUploads = todayLimit;
        if (todayLimit > 0) {
          if (now >= windowStart && now <= windowEnd) {
            const elapsedMinutes = differenceInMinutes(now, windowStart);
            const totalWindowMinutes = differenceInMinutes(windowEnd, windowStart);
            const progress = Math.min(Math.max(elapsedMinutes / totalWindowMinutes, 0), 1);
            expectedUploads = Math.floor(todayLimit * progress) + 1;
          } else if (now < windowStart) {
            expectedUploads = 0; // Window hasn't started yet
          }
        }

        const uploadedToday = await UploadLogModel.countTodaySuccessByAccount(accountId);
        const inQueue = await queue.countPendingForAccount(accountId);

        // Limit reached for the day
        if (todayLimit > 0 && uploadedToday + inQueue >= todayLimit) {
          if (inQueue === 0 && uploadedToday === todayLimit) {
            logger.info('Daily upload limit reached for account', {
              accountId,
              uploadedToday,
              todayLimit,
            });
            // Only notify if we exactly just hit it to avoid spam, though state tracking would be better.
            // For now, it will just quietly skip.
          }
          continue;
        }

        // Pacing limit reached
        if (todayLimit > 0 && uploadedToday + inQueue >= expectedUploads) {
          logger.debug('Upload pacing active: ahead of schedule', {
            accountId,
            uploadedToday,
            inQueue,
            expectedUploads,
            todayLimit,
          });
          continue;
        }

        // Calculate how many we are allowed to enqueue right now
        const allowedToEnqueue =
          todayLimit > 0 ? expectedUploads - (uploadedToday + inQueue) : Infinity;
        if (allowedToEnqueue <= 0) continue;

        // ── 4. Fetch from Drive ──
        const files = await driveService.listVideoFiles({ folderId: account.driveFolderId });
        if (files.length === 0) continue;

        let enqueued = 0;
        let skipped = 0;

        for (const file of files) {
          if (enqueued >= allowedToEnqueue) {
            skipped++; // Skip remaining to respect pacing
            continue;
          }

          if (await ProcessedFileModel.isProcessed(file.id)) {
            skipped++;
            continue;
          }

          if (await UploadLogModel.wasUploadedTodayByName(file.name, accountId)) {
            skipped++;
            continue;
          }

          if (await queue.isProcessing(file.id)) {
            skipped++;
            continue;
          }

          const job = await queue.enqueue(file, accountId, account.driveUploadedFolderId);
          if (job) {
            enqueued++;
            logger.info('Enqueued file for upload', {
              fileId: file.id,
              name: file.name,
              accountId,
            });
          } else {
            skipped++;
          }
        }

        totalEnqueued += enqueued;
        totalSkipped += skipped;

        const auditLogData = {
          accountId,
          enqueued,
          skipped,
          allowedToEnqueue,
          expectedUploads,
          todayLimit,
          uploadedToday,
          inQueue,
          postingWindowStart: windowStartStr,
          postingWindowEnd: windowEndStr,
        };

        if (enqueued > 0) {
          logger.info('Poll cycle complete for account (Audit)', auditLogData);
        } else {
          logger.debug('Poll cycle complete (No action taken)', auditLogData);
        }
      }

      if (queueWarningThreshold > 0) {
        const queue = getUploadQueue();
        const stats = await queue.getStats();
        const totalPending = stats.pending;

        if (totalPending >= queueWarningThreshold && !this.largeQueueWarned) {
          this.largeQueueWarned = true;
          logger.warn('Large upload queue detected', { totalPending, queueWarningThreshold });
          await getNotificationService().notifyLargeQueue(totalPending, queueWarningThreshold);
        } else if (totalPending < queueWarningThreshold) {
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

let schedulerService: SchedulerService | null = null;
export function getSchedulerService(): SchedulerService {
  if (!schedulerService) {
    schedulerService = new SchedulerService();
  }
  return schedulerService;
}
