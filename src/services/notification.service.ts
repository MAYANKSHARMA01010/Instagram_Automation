import axios from 'axios';
import { getConfig } from '../config';
import { UploadLogModel } from '../database/repository';
import { BatchSummary } from '../types/upload.types';
import { getStatisticsService } from './statistics.service';
import logger from '../utils/logger';
import { truncate } from '../utils/helpers';
import { calculateWarmupDay, getWarmupLimit } from '../utils/warmup.util';

// ─── Payload Interfaces ───────────────────────────────────────────────────────

export interface StartedPayload {
  fileName: string;
  queuePosition: number; // 1-based position in current batch
  totalInQueue: number; // total pending when job started
  startTime: Date;
  accountId?: string;
}

export interface SuccessPayload {
  fileName: string;
  instagramMediaId: string;
  uploadTimeMs: number;
  driveFileId: string;
  queueRemaining: number; // jobs still pending after this one
  accountId?: string;
}

export interface FailurePayload {
  fileName: string;
  reason: string;
  stack?: string;
  driveFileId: string;
  httpStatus?: number; // HTTP status code if available
  retryCount: number; // how many attempts were made
  accountId?: string;
}

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * Service for sending professional Telegram notifications at every stage
 * of the upload pipeline.
 *
 * All notification methods are fire-and-forget — a Telegram failure will
 * never crash the upload pipeline.
 */
export class NotificationService {
  private readonly config = getConfig();
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = `https://api.telegram.org/bot${this.config.telegram.botToken}`;
  }

  /**
   * Returns true if Telegram notifications are configured.
   */
  private isConfigured(): boolean {
    return !!(this.config.telegram.botToken && this.config.telegram.chatId);
  }

  // ─── REQ-6a: Upload Started ──────────────────────────────────────────────

  /**
   * Sent when a job moves from PENDING to DOWNLOADING.
   */
  async notifyUploadStarted(payload: StartedPayload): Promise<void> {
    if (!this.isConfigured()) return;

    const startStr = payload.startTime.toUTCString();

    const header = '▶️ *Upload Started*';
    const account = this.config.accounts.find((a) => a.instagramAccountId === payload.accountId);

    const message = [
      header,
      '',
      `👤 *Account:* ${account?.accountName ? this.esc(account.accountName) : 'Unknown'}`,
      `📹 *File:* \`${this.esc(payload.fileName)}\``,
      `🔢 *Queue Position:* ${payload.queuePosition} of ${payload.totalInQueue}`,
      `🕐 *Start Time:* ${startStr}`,
    ].join('\n');

    await this.sendMessage(message, account?.telegramThreadId);
  }

  // ─── REQ-6b: Upload Success ──────────────────────────────────────────────

  /**
   * Sent when a Reel has been published successfully.
   */
  async notifySuccess(payload: SuccessPayload): Promise<void> {
    if (!this.isConfigured()) {
      logger.debug('Telegram not configured, skipping success notification');
      return;
    }

    const uploadSeconds = Math.round(payload.uploadTimeMs / 1000);
    const totalToday = await UploadLogModel.countTodaySuccess();
    const startTime = new Date(Date.now() - payload.uploadTimeMs).toUTCString();
    const stats = getStatisticsService().getDailySummary();

    const header = '✅ *Reel Uploaded Successfully*';
    const account = this.config.accounts.find((a) => a.instagramAccountId === payload.accountId);

    const message = [
      header,
      '',
      `👤 *Account:* ${account?.accountName ? this.esc(account.accountName) : 'Unknown'}`,
      `📹 *File:* \`${this.esc(payload.fileName)}\``,
      `⏱ *Upload Time:* ${uploadSeconds}s`,
      `🆔 *Instagram Media ID:* \`${payload.instagramMediaId}\``,
      `📂 *Drive ID:* \`${payload.driveFileId}\``,
      `🔜 *Queue Remaining:* ${payload.queueRemaining} video(s)`,
      `📊 *Total Uploaded Today:* ${totalToday}`,
      `🌐 *Meta API Calls Today:* ${stats.metaApiCallsToday}`,
      `✅ *Success Rate Today:* ${stats.successRate}`,
      `🕐 *Started:* ${startTime}`,
      `🕐 *Completed:* ${new Date().toUTCString()}`,
    ].join('\n');

    await this.sendMessage(message, account?.telegramThreadId);
  }

  // ─── REQ-6c: Upload Failed ───────────────────────────────────────────────

  /**
   * Sent when an upload fails after all retry attempts.
   */
  async notifyFailure(payload: FailurePayload): Promise<void> {
    if (!this.isConfigured()) {
      logger.debug('Telegram not configured, skipping failure notification');
      return;
    }

    const stackPreview = payload.stack ? truncate(payload.stack, 300) : 'N/A';
    const httpLine = payload.httpStatus ? `\n🌐 *HTTP Status:* ${payload.httpStatus}` : '';
    const stats = getStatisticsService().getDailySummary();
    const errorCategory = getStatisticsService().categoriseError(payload.reason);

    const header = '❌ *Reel Upload Failed*';
    const account = this.config.accounts.find((a) => a.instagramAccountId === payload.accountId);

    const message = [
      header,
      '',
      `👤 *Account:* ${account?.accountName ? this.esc(account.accountName) : 'Unknown'}`,
      `📹 *File:* \`${this.esc(payload.fileName)}\``,
      `📂 *Drive ID:* \`${payload.driveFileId}\``,
      `💬 *Error:* ${this.esc(payload.reason)}${httpLine}`,
      `🚫 *Error Category:* ${errorCategory}`,
      `🔁 *Retry Count:* ${payload.retryCount}`,
      `📊 *Today: ${stats.uploadsToday} uploaded / ${stats.failuresToday} failed (${stats.successRate} success)*`,
      `🌐 *Meta API Calls Today:* ${stats.metaApiCallsToday}`,
      `🔍 *Stack:*\n\`\`\`\n${this.esc(stackPreview)}\n\`\`\``,
      `🕐 *Failed At:* ${new Date().toUTCString()}`,
    ].join('\n');

    await this.sendMessage(message, account?.telegramThreadId);
  }

  // ─── REQ-6d: Batch Finished ──────────────────────────────────────────────

  /**
   * Sent after the last video in a batch finishes (success or failure).
   */
  async notifyBatchFinished(summary: BatchSummary): Promise<void> {
    if (!this.isConfigured()) return;

    const totalSecs = Math.round(summary.totalProcessingMs / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    const durationStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    const stats = getStatisticsService().getDailySummary();

    const successEmoji = summary.totalFailed === 0 ? '🎉' : '⚠️';

    // Build error breakdown line if there were failures
    let errorBreakdownLine = '';
    if (Object.keys(stats.errorBreakdown).length > 0) {
      const breakdown = Object.entries(stats.errorBreakdown)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
      errorBreakdownLine = `\n🚫 *Error Breakdown:* ${breakdown}`;
    }

    // Build per-account breakdown
    let accountBreakdownLine = '';
    if (stats.accountSummaries.length > 0) {
      const lines = stats.accountSummaries
        .map((a) => {
          const avgSec = a.uploads > 0 ? Math.round(a.totalUploadMs / a.uploads / 1000) : 0;
          const statusIcon = a.failures > 0 ? '⚠️' : '✅';
          return `  ${statusIcon} *${this.esc(a.accountName)}* (\`${a.instagramAccountId}\`): ${a.uploads} uploaded, ${a.failures} failed, ${a.metaApiCalls} API calls, avg ${avgSec}s`;
        })
        .join('\n');
      accountBreakdownLine = `\n\n👥 *Per-Account Breakdown:*\n${lines}`;
    }

    const message = [
      `${successEmoji} *Batch Upload Complete*`,
      '',
      `📦 *Total Videos Found:* ${summary.totalFound}`,
      `✅ *Successfully Uploaded:* ${summary.totalSuccess}`,
      `❌ *Failed:* ${summary.totalFailed}`,
      `⏭️ *Skipped (already uploaded):* ${summary.totalSkipped}`,
      `⏱ *Total Processing Time:* ${durationStr}`,
      `⚡ *Avg Upload Time:* ${stats.avgUploadTimeSeconds}s per video`,
      `🌐 *Meta API Calls Today:* ${stats.metaApiCallsToday}`,
      `✅ *Success Rate Today:* ${stats.successRate}`,
      `🔁 *Total Retries Today:* ${stats.retriesToday}${errorBreakdownLine}${accountBreakdownLine}`,
      `🕐 *Completed:* ${new Date().toUTCString()}`,
    ].join('\n');

    await this.sendMessage(message);
  }

  /**
   * Sent as a daily recap at midnight. Summarises the full day's performance.
   */
  async notifyDailySummary(): Promise<void> {
    if (!this.isConfigured()) return;

    const stats = getStatisticsService().getDailySummary();
    const totalAttempts = stats.uploadsToday + stats.failuresToday;

    if (totalAttempts === 0) return; // Nothing happened today, skip summary

    let errorBreakdownLine = '';
    if (Object.keys(stats.errorBreakdown).length > 0) {
      const breakdown = Object.entries(stats.errorBreakdown)
        .map(([k, v]) => `  • ${k}: ${v}x`)
        .join('\n');
      errorBreakdownLine = `\n\n🚫 *Error Breakdown:*\n${breakdown}`;
    }

    // Per-account breakdown
    let accountBreakdownLine = '';
    if (stats.accountSummaries.length > 0) {
      const lines = stats.accountSummaries
        .map((a) => {
          const avgSec = a.uploads > 0 ? Math.round(a.totalUploadMs / a.uploads / 1000) : 0;
          const statusIcon = a.failures > 0 ? '⚠️' : '✅';
          return `  ${statusIcon} *${this.esc(a.accountName)}* (\`${a.instagramAccountId}\`)\n     📤 Uploaded: ${a.uploads} | ❌ Failed: ${a.failures} | 🌐 API Calls: ${a.metaApiCalls} | ⚡ Avg: ${avgSec}s`;
        })
        .join('\n');
      accountBreakdownLine = `\n\n👥 *Per-Account Breakdown:*\n${lines}`;
    }

    const message = [
      '📅 *Daily Summary Report*',
      '',
      `📊 *Total Attempts:* ${totalAttempts}`,
      `✅ *Successful Uploads:* ${stats.uploadsToday}`,
      `❌ *Failed Uploads:* ${stats.failuresToday}`,
      `🏆 *Success Rate:* ${stats.successRate}`,
      `⚡ *Avg Upload Time:* ${stats.avgUploadTimeSeconds}s per video`,
      `🌐 *Total Meta API Calls:* ${stats.metaApiCallsToday}`,
      `🔁 *Total Retries:* ${stats.retriesToday}`,
      `🕐 *Report Time:* ${new Date().toUTCString()}${errorBreakdownLine}${accountBreakdownLine}`,
    ].join('\n');

    await this.sendMessage(message);
  }

  // ─── System Notifications ────────────────────────────────────────────────

  /**
   * Sent when the server starts up — now includes account list and config summary.
   */
  async notifyStartup(): Promise<void> {
    if (!this.isConfigured()) return;

    const globalDailyLimit = this.config.upload.dailyUploadLimit;
    const globalLimitLine = globalDailyLimit > 0 ? `${globalDailyLimit} videos/day` : 'Unlimited';

    const accountLines = this.config.accounts
      .map((a, i) => {
        let limitDetails = `Global: ${globalLimitLine}`;
        if (a.enableWarmup || a.isNewAccount) {
          const targetLimit = a.targetDailyLimit ?? this.config.upload.targetDailyLimit;
          const day = calculateWarmupDay(a.warmupStartDate);
          let baseLimit = getWarmupLimit(day, targetLimit);
          if (globalDailyLimit > 0) {
            baseLimit = Math.min(baseLimit, globalDailyLimit);
          }
          limitDetails = `Warmup Day ${day} (Max: ${baseLimit} videos)`;
        }
        return `  ${i + 1}. *${this.esc(a.accountName ?? a.instagramAccountId)}* (\`${a.instagramAccountId}\`) - ${limitDetails}`;
      })
      .join('\n');

    await this.sendMessage(
      `🚀 *Instagram Reels Uploader Started*\n\n` +
        `The automation system is online and monitoring Google Drive.\n\n` +
        `👥 *Active Accounts (${this.config.accounts.length}):*\n${accountLines}\n\n` +
        `⏱ *Upload Delay:* ${this.config.upload.uploadDelaySeconds}s between uploads\n` +
        `📊 *Global Limit:* ${globalLimitLine}\n` +
        `🔄 *Poll Interval:* \`${this.config.upload.pollingCron}\``,
    );
  }

  /**
   * Sent when the Graph API token is expiring soon.
   */
  async notifyTokenExpirySoon(daysLeft: number, expiryDate: string): Promise<void> {
    if (!this.isConfigured()) return;

    const urgencyEmoji = daysLeft <= 3 ? '🚨' : '⚠️';
    await this.sendMessage(
      `${urgencyEmoji} *Graph API Token Expiring Soon!*\n\n` +
        `Your Meta Graph API token will expire in *${daysLeft} day(s)* on *${expiryDate}*.\n\n` +
        `If you don't renew it, ALL uploads will stop failing with an Auth Error!\n\n` +
        `*To renew:* Go to Meta for Developers → Tools → Graph API Explorer → Generate new long-lived token, then update \`GRAPH_API_TOKEN\` in your Render environment variables.`,
    );
  }

  /**
   * Sent when the daily upload limit is reached for an account.
   */
  async notifyDailyLimitReached(
    accountName: string,
    accountId: string,
    limit: number,
  ): Promise<void> {
    if (!this.isConfigured()) return;

    await this.sendMessage(
      `🛑 *Daily Upload Limit Reached*\n\n` +
        `👤 *Account:* ${this.esc(accountName)} (\`${accountId}\`)\n` +
        `📊 *Daily Limit:* ${limit} videos\n\n` +
        `The bot will automatically resume uploading for this account tomorrow (after midnight UTC / 5:30 AM IST).\n\n` +
        `To change the limit, update \`DAILY_UPLOAD_LIMIT\` in your Render environment variables.`,
    );
  }

  /**
   * Sent when the upload queue grows unusually large.
   */
  async notifyLargeQueue(queueSize: number, threshold: number): Promise<void> {
    if (!this.isConfigured()) return;

    await this.sendMessage(
      `⚠️ *Large Upload Queue Detected*\n\n` +
        `📦 *Queue Size:* ${queueSize} videos (threshold: ${threshold})\n\n` +
        `This usually means many videos were added to Google Drive at once. The bot will process them one by one with the configured delay.\n\n` +
        `⏱ *Estimated completion:* ~${Math.round((queueSize * this.config.upload.uploadDelaySeconds) / 60)} minutes`,
    );
  }

  // ─── Health & Warm-up Notifications ──────────────────────────────────────

  async notifyWarmupStarted(accountId: string, day: number, limit: number): Promise<void> {
    if (!this.isConfigured()) return;
    await this.sendMessage(
      `🌱 *Warm-up Started*\n\n` +
        `👤 *Account:* \`${accountId}\`\n` +
        `📅 *Day:* ${day} of 30\n` +
        `📈 *Today's Limit:* ${limit} videos\n\n` +
        `Uploads will be spaced out naturally throughout your configured posting window.`,
    );
  }

  async notifyWarmupCompleted(accountId: string): Promise<void> {
    if (!this.isConfigured()) return;
    await this.sendMessage(
      `🎉 *Warm-up Completed!*\n\n` +
        `👤 *Account:* \`${accountId}\`\n\n` +
        `This account has successfully survived the 30-day warm-up period. Target limits are now unlocked.`,
    );
  }

  async notifyCooldownStarted(accountId: string, hours: number, score: number): Promise<void> {
    if (!this.isConfigured()) return;
    await this.sendMessage(
      `🚨 *CRITICAL: Account in Cooldown*\n\n` +
        `👤 *Account:* \`${accountId}\`\n` +
        `💔 *Health Score:* ${score}/100 (Critical)\n` +
        `⏸️ *Action:* Halting all uploads for ${hours} hours.\n\n` +
        `The bot will automatically resume after the cooldown expires.`,
    );
  }

  async notifyCooldownEnded(accountId: string, score: number): Promise<void> {
    if (!this.isConfigured()) return;
    await this.sendMessage(
      `🟢 *Cooldown Expired*\n\n` +
        `👤 *Account:* \`${accountId}\`\n` +
        `💔 *Health Score:* ${score}/100\n\n` +
        `Resuming uploads cautiously.`,
    );
  }

  async notifyHealthDegraded(
    accountId: string,
    oldBand: string,
    newBand: string,
    score: number,
  ): Promise<void> {
    if (!this.isConfigured()) return;
    await this.sendMessage(
      `📉 *Health Score Degraded*\n\n` +
        `👤 *Account:* \`${accountId}\`\n` +
        `💔 *Score:* ${score}/100\n` +
        `🚦 *Band:* ${oldBand} ➡️ ${newBand}\n\n` +
        `Action blocked or checkpoint detected. Proceeding with extreme caution.`,
    );
  }

  async notifyHealthRecovered(
    accountId: string,
    oldBand: string,
    newBand: string,
    score: number,
  ): Promise<void> {
    if (!this.isConfigured()) return;
    await this.sendMessage(
      `📈 *Health Score Recovered*\n\n` +
        `👤 *Account:* \`${accountId}\`\n` +
        `💚 *Score:* ${score}/100\n` +
        `🚦 *Band:* ${oldBand} ➡️ ${newBand}`,
    );
  }

  async notifyRestrictionDetected(accountId: string, errorMessage: string): Promise<void> {
    if (!this.isConfigured()) return;
    await this.sendMessage(
      `⚠️ *Platform Restriction Detected*\n\n` +
        `👤 *Account:* \`${accountId}\`\n` +
        `💬 *Details:* ${this.esc(errorMessage)}\n\n` +
        `Heavy penalty applied to health score.`,
    );
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────

  /**
   * Sends a raw message to the configured Telegram chat (MarkdownV2 parse mode).
   * Optionally sends to a specific thread/topic.
   * Never throws — always catches and logs errors.
   */
  private async sendMessage(text: string, threadId?: string): Promise<void> {
    try {
      await axios.post(`${this.baseUrl}/sendMessage`, {
        chat_id: this.config.telegram.chatId,
        message_thread_id: threadId,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      });

      logger.debug('Telegram notification sent', { threadId });
    } catch (error: unknown) {
      // Notification failures must never crash the upload pipeline
      let errorMsg: string;
      if (axios.isAxiosError(error) && error.response?.data) {
        errorMsg = JSON.stringify(error.response.data);
      } else if (error instanceof Error) {
        errorMsg = error.message;
      } else {
        errorMsg = String(error);
      }
      logger.error('Failed to send Telegram notification', { error: errorMsg });
    }
  }

  /**
   * Escapes special Markdown characters for Telegram.
   */
  private esc(text: string): string {
    return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
  }
}

// Singleton
let notificationService: NotificationService | null = null;

export function getNotificationService(): NotificationService {
  if (!notificationService) {
    notificationService = new NotificationService();
  }
  return notificationService;
}
