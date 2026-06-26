import axios from 'axios';
import { getConfig } from '../config';
import { UploadLogModel } from '../database/repository';
import { BatchSummary } from '../types/upload.types';
import logger from '../utils/logger';
import { truncate } from '../utils/helpers';

// ─── Payload Interfaces ───────────────────────────────────────────────────────

export interface StartedPayload {
  fileName: string;
  queuePosition: number; // 1-based position in current batch
  totalInQueue: number; // total pending when job started
  startTime: Date;
}

export interface SuccessPayload {
  fileName: string;
  instagramMediaId: string;
  uploadTimeMs: number;
  driveFileId: string;
  queueRemaining: number; // jobs still pending after this one
}

export interface FailurePayload {
  fileName: string;
  reason: string;
  stack?: string;
  driveFileId: string;
  httpStatus?: number; // HTTP status code if available
  retryCount: number; // how many attempts were made
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

    const message = [
      '▶️ *Upload Started*',
      '',
      `📹 *File:* \`${this.esc(payload.fileName)}\``,
      `🔢 *Queue Position:* ${payload.queuePosition} of ${payload.totalInQueue}`,
      `🕐 *Start Time:* ${startStr}`,
    ].join('\n');

    await this.sendMessage(message);
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

    const message = [
      '✅ *Reel Uploaded Successfully*',
      '',
      `📹 *File:* \`${this.esc(payload.fileName)}\``,
      `⏱ *Upload Time:* ${uploadSeconds}s`,
      `🆔 *Instagram Media ID:* \`${payload.instagramMediaId}\``,
      `📂 *Drive ID:* \`${payload.driveFileId}\``,
      `🔜 *Queue Remaining:* ${payload.queueRemaining} video(s)`,
      `📊 *Total Uploaded Today:* ${totalToday}`,
      `🕐 *Completed:* ${new Date().toUTCString()}`,
    ].join('\n');

    await this.sendMessage(message);
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

    const message = [
      '❌ *Reel Upload Failed*',
      '',
      `📹 *File:* \`${this.esc(payload.fileName)}\``,
      `📂 *Drive ID:* \`${payload.driveFileId}\``,
      `💬 *Error:* ${this.esc(payload.reason)}${httpLine}`,
      `🔁 *Retry Count:* ${payload.retryCount}`,
      `🔍 *Stack:*\n\`\`\`\n${this.esc(stackPreview)}\n\`\`\``,
      `🕐 *Time:* ${new Date().toUTCString()}`,
    ].join('\n');

    await this.sendMessage(message);
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

    const successEmoji = summary.totalFailed === 0 ? '🎉' : '⚠️';

    const message = [
      `${successEmoji} *Batch Upload Complete*`,
      '',
      `📦 *Total Videos Found:* ${summary.totalFound}`,
      `✅ *Successfully Uploaded:* ${summary.totalSuccess}`,
      `❌ *Failed:* ${summary.totalFailed}`,
      `⏭️ *Skipped (already uploaded):* ${summary.totalSkipped}`,
      `⏱ *Total Processing Time:* ${durationStr}`,
      `🕐 *Completed:* ${new Date().toUTCString()}`,
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
   * Never throws — always catches and logs errors.
   */
  private async sendMessage(text: string): Promise<void> {
    try {
      await axios.post(`${this.baseUrl}/sendMessage`, {
        chat_id: this.config.telegram.chatId,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      });

      logger.debug('Telegram notification sent');
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
