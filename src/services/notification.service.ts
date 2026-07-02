import axios from 'axios';
import { getConfig } from '../config';
import { UploadLogModel } from '../database/repository';
import { BatchSummary } from '../types/upload.types';
import { getStatisticsService } from './statistics.service';
import logger from '../utils/logger';
import { truncate } from '../utils/helpers';

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
    
    let header = '▶️ *Upload Started*';
    const account = this.config.accounts.find(a => a.instagramAccountId === payload.accountId);

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

    let header = '✅ *Reel Uploaded Successfully*';
    const account = this.config.accounts.find(a => a.instagramAccountId === payload.accountId);

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

    let header = '❌ *Reel Upload Failed*';
    const account = this.config.accounts.find(a => a.instagramAccountId === payload.accountId);

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
      const lines = stats.accountSummaries.map(a => {
        const avgSec = a.uploads > 0 ? Math.round(a.totalUploadMs / a.uploads / 1000) : 0;
        const statusIcon = a.failures > 0 ? '⚠️' : '✅';
        return `  ${statusIcon} *${this.esc(a.accountName)}* (\`${a.instagramAccountId}\`): ${a.uploads} uploaded, ${a.failures} failed, ${a.metaApiCalls} API calls, avg ${avgSec}s`;
      }).join('\n');
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
      const lines = stats.accountSummaries.map(a => {
        const avgSec = a.uploads > 0 ? Math.round(a.totalUploadMs / a.uploads / 1000) : 0;
        const statusIcon = a.failures > 0 ? '⚠️' : '✅';
        return `  ${statusIcon} *${this.esc(a.accountName)}* (\`${a.instagramAccountId}\`)\n     📤 Uploaded: ${a.uploads} | ❌ Failed: ${a.failures} | 🌐 API Calls: ${a.metaApiCalls} | ⚡ Avg: ${avgSec}s`;
      }).join('\n');
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
   * Sent when the server starts up.
   */
  async notifyStartup(): Promise<void> {
    if (!this.isConfigured()) return;

    await this.sendMessage(
      '🚀 *Instagram Reels Uploader Started*\n\n' +
        'The automation system is online and monitoring Google Drive.',
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
    } catch (error) {
      // Notification failures must never crash the upload pipeline
      logger.error('Failed to send Telegram notification', {
        error: error instanceof Error ? error.message : String(error),
      });
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
