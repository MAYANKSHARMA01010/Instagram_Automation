import { UploadJob } from '../types/upload.types';
import { UploadJobModel, UploadLogModel, ProcessedFileModel } from '../database/repository';
import { getDriveService } from '../services/google-drive.service';
import { getInstagramService } from '../services/instagram.service';
import { getCaptionService } from '../services/caption.service';
import { getNotificationService } from '../services/notification.service';
import { getUploadQueue } from '../queue/upload.queue';
import { validateFile } from '../utils/file-validator';
import { safeDeleteFile, elapsedMs } from '../utils/helpers';
import { getConfig } from '../config';
import logger from '../utils/logger';

/**
 * Core upload worker that orchestrates the full upload pipeline:
 * Download → Validate → Upload to Meta → Create Container → Poll Status
 * → Publish → Move to Uploaded → Notify
 *
 * REQ-3: Cover image is attempted; if the API does not support it,
 *         a warning is logged and the upload continues.
 * REQ-6: Sends rich Telegram notifications at success and failure.
 * REQ-7: Writes complete timing data to upload_logs.
 */
export class UploadWorker {
  private readonly config = getConfig();

  /**
   * Processes a single upload job through the complete pipeline.
   * Returns true on success, false on failure.
   *
   * This method is guaranteed to catch and handle all errors internally.
   * It never throws — the sequential processor relies on this guarantee.
   */
  async processJob(job: UploadJob): Promise<boolean> {
    const queueStartTime = job.createdAt.toISOString();
    const uploadStartTime = new Date();

    logger.info('Starting upload pipeline', {
      jobId: job.id,
      fileName: job.driveFileName,
      driveFileId: job.driveFileId,
      attempt: job.retryCount + 1,
    });

    let localFilePath: string | undefined;

    try {
      // ── Step 1: Download from Google Drive ─────────────────────────────────
      await UploadJobModel.update(job.id, { status: 'DOWNLOADING' });

      const driveService = getDriveService();
      const downloadResult = await driveService.downloadFile(job.driveFileId, job.driveFileName);

      localFilePath = downloadResult.filePath;
      await UploadJobModel.update(job.id, { localFilePath });

      logger.info('File downloaded successfully', {
        jobId: job.id,
        localFilePath,
        sizeBytes: downloadResult.fileSize,
      });

      // ── Step 2: Validate file ───────────────────────────────────────────────
      const validation = validateFile({
        filePath: localFilePath,
        mimeType: downloadResult.mimeType,
        fileSize: downloadResult.fileSize,
      });

      if (!validation.valid) {
        const errorMsg = `File validation failed: ${validation.errors.join('; ')}`;

        // Mark as processed to avoid re-processing permanently invalid files
        await ProcessedFileModel.markProcessed({
          driveFileId: job.driveFileId,
          driveFileName: job.driveFileName,
        });

        await this.failJob(job, errorMsg, undefined, undefined, uploadStartTime, queueStartTime);
        return false;
      }

      // ── Step 3: Construct Public URL for Instagram servers ────────────────────
      await UploadJobModel.update(job.id, { status: 'UPLOADING' });

      const instagramService = getInstagramService();
      const captionService = getCaptionService();
      const caption = captionService.getCaption();

      // Instagram Graph API requires a publicly accessible URL for Reels.
      // We serve the downloaded tmp file via the /public/tmp route.
      const host = process.env.PUBLIC_URL ?? `http://localhost:${this.config.app.port}`;
      const videoFileName = localFilePath.split('/').pop() ?? 'video.mp4';
      const videoUrl = `${host}/public/tmp/${videoFileName}`;

      logger.info('Exposing video via public URL for Instagram API', { videoUrl });

      // ── Step 4: Create Instagram Reel container ─────────────────────────────
      await UploadJobModel.update(job.id, { status: 'PROCESSING' });

      const accountId = job.instagramAccountId ?? this.config.instagram.accountId;
      const account = this.config.accounts.find((a) => a.instagramAccountId === accountId);
      const sourceFolderId = account?.driveFolderId ?? this.config.google.driveFolderId;

      let coverUrl: string | undefined;

      try {
        const coverFile = await driveService.findCoverImage(sourceFolderId);
        if (coverFile) {
          const downloadResult = await driveService.downloadFile(coverFile.id, coverFile.name);
          const host = process.env.PUBLIC_URL ?? `http://localhost:${this.config.app.port}`;
          const coverFileName = downloadResult.filePath.split('/').pop();
          coverUrl = `${host}/public/tmp/${coverFileName}`;
          logger.info('Using dynamic cover image from Google Drive', { coverUrl, sourceFolderId });
        }
      } catch (coverErr) {
        logger.warn('Could not download dynamic cover image — proceeding without or with fallback', {
          sourceFolderId,
          error: coverErr instanceof Error ? coverErr.message : String(coverErr),
        });
      }

      // Fallback to static cover image if drive folder doesn't have one
      if (!coverUrl) {
        const coverImagePath = this.config.content.coverImage;
        if (coverImagePath) {
          try {
            // Cover must be a publicly accessible URL for the Graph API.
            // For self-hosted deployments, serve it from the /public endpoint.
            const host = process.env.PUBLIC_URL ?? `http://localhost:${this.config.app.port}`;
            coverUrl = `${host}/public/cover/${coverImagePath.split('/').pop() ?? 'cover.jpg'}`;
            logger.debug('Using local fallback cover image URL', { coverUrl });
          } catch (coverErr) {
            logger.warn('Could not construct local cover image URL — uploading without cover', {
              coverImagePath,
              error: coverErr instanceof Error ? coverErr.message : String(coverErr),
            });
            coverUrl = undefined;
          }
        }
      }

      let container;
      try {
        container = await instagramService.createReelContainer(accountId, videoUrl, caption, coverUrl);
      } catch (containerErr) {
        // REQ-3: If container creation with cover fails, retry without cover
        if (
          coverUrl &&
          containerErr instanceof Error &&
          containerErr.message.toLowerCase().includes('cover')
        ) {
          logger.warn('Container creation with cover failed — retrying without cover', {
            error: containerErr.message,
          });
          container = await instagramService.createReelContainer(accountId, videoUrl, caption, undefined);
        } else {
          throw containerErr;
        }
      }

      await UploadJobModel.update(job.id, {
        status: 'PROCESSING',
        instagramContainerId: container.id,
      });

      logger.info('Container created, polling for readiness', {
        jobId: job.id,
        containerId: container.id,
      });

      // ── Step 5: Poll until Instagram finishes processing ────────────────────
      await instagramService.waitForContainerReady(container.id);

      // ── Step 6: Publish the Reel ────────────────────────────────────────────
      await UploadJobModel.update(job.id, { status: 'PUBLISHING' });

      const publishResult = await instagramService.publishReel(accountId, container.id);
      const instagramMediaId = publishResult.id;

      await UploadJobModel.update(job.id, { status: 'COMPLETED', instagramMediaId });

      logger.info('Reel published successfully', {
        jobId: job.id,
        instagramMediaId,
        fileName: job.driveFileName,
      });

      // ── Step 7: Move file to Uploaded folder in Drive ───────────────────────
      const uploadedFolderId = job.uploadedDriveFolderId ?? this.config.google.driveUploadedFolderId;
      await driveService.moveToUploaded(job.driveFileId, job.driveFileName, uploadedFolderId);

      // ── Step 8: Record in processed_files (prevents re-upload) ─────────────
      await ProcessedFileModel.markProcessed({
        driveFileId: job.driveFileId,
        driveFileName: job.driveFileName,
        instagramMediaId,
      });

      // ── Step 9: Write full upload log (REQ-7) ───────────────────────────────
      const uploadEndTime = new Date();
      const durationMs = elapsedMs(uploadStartTime);

      await UploadLogModel.create({
        driveFileId: job.driveFileId,
        driveFileName: job.driveFileName,
        status: 'COMPLETED',
        instagramMediaId,
        durationMs,
        queueStartTime,
        uploadStartTime: uploadStartTime.toISOString(),
        uploadEndTime: uploadEndTime.toISOString(),
        retryCount: job.retryCount,
        instagramAccountId: accountId,
        uploadedDriveFolderId: uploadedFolderId,
      });

      // ── Step 10: Send success notification (REQ-6b) ─────────────────────────
      const queueRemaining = await getUploadQueue().countPending();
      const notificationService = getNotificationService();
      await notificationService.notifySuccess({
        fileName: job.driveFileName,
        instagramMediaId,
        uploadTimeMs: durationMs,
        driveFileId: job.driveFileId,
        queueRemaining,
        accountId,
      });

      logger.info('Upload pipeline completed successfully', {
        jobId: job.id,
        fileName: job.driveFileName,
        instagramMediaId,
        durationMs,
      });

      return true;
    } catch (error) {
      const httpStatus = this.extractHttpStatus(error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      await this.failJob(
        job,
        errorMessage,
        errorStack,
        httpStatus,
        uploadStartTime,
        queueStartTime,
      );
      return false;
    } finally {
      // ── Cleanup: Remove temp file regardless of outcome ────────────────────
      if (localFilePath) {
        safeDeleteFile(localFilePath);
        logger.debug('Temp file cleaned up', { localFilePath });
      }
    }
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────

  /**
   * Marks a job as failed, writes the full log record, and sends a
   * rich Telegram failure notification.
   */
  private async failJob(
    job: UploadJob,
    errorMessage: string,
    errorStack: string | undefined,
    httpStatus: number | undefined,
    uploadStartTime: Date,
    queueStartTime: string,
  ): Promise<void> {
    const uploadEndTime = new Date();
    const durationMs = elapsedMs(uploadStartTime);

    await UploadJobModel.update(job.id, {
      status: 'FAILED',
      errorMessage,
      errorStack,
    });

    // REQ-7: Write complete timing data
    await UploadLogModel.create({
      driveFileId: job.driveFileId,
      driveFileName: job.driveFileName,
      status: 'FAILED',
      errorMessage,
      durationMs,
      queueStartTime,
      uploadStartTime: uploadStartTime.toISOString(),
      uploadEndTime: uploadEndTime.toISOString(),
      retryCount: job.retryCount,
    });

    logger.error('Upload job failed', {
      jobId: job.id,
      fileName: job.driveFileName,
      errorMessage,
      httpStatus,
      retryCount: job.retryCount,
      durationMs,
    });

    // REQ-6c: Rich failure notification
    const notificationService = getNotificationService();
    await notificationService.notifyFailure({
      fileName: job.driveFileName,
      reason: errorMessage,
      stack: errorStack,
      driveFileId: job.driveFileId,
      httpStatus,
      retryCount: job.retryCount,
      accountId: job.instagramAccountId ?? undefined,
    });
  }

  /**
   * Extracts the HTTP status code from an Axios error if available.
   */
  private extractHttpStatus(error: unknown): number | undefined {
    if (error && typeof error === 'object' && 'response' in error) {
      const response = (error as { response?: { status?: number } }).response;
      if (response?.status) return response.status;
    }
    return undefined;
  }

  /**
   * Returns the number of currently active jobs (0 or 1 with sequential mode).
   */
  getActiveCount(): number {
    return 0; // Sequential mode — the DownloadWorker owns the single active slot
  }
}

// Singleton
let uploadWorker: UploadWorker | null = null;

export function getUploadWorker(): UploadWorker {
  if (!uploadWorker) {
    uploadWorker = new UploadWorker();
  }
  return uploadWorker;
}
