import { google, drive_v3 } from 'googleapis';
import fs from 'fs';
import { getOAuth2Client } from '../utils/token-manager';
import { DriveFile, DriveDownloadResult, DriveListOptions } from '../types/drive.types';
import { isMp4File, sanitizeFileName } from '../utils/file-validator';
import { getTempFilePath } from '../utils/helpers';
import { withRetry } from '../utils/retry';
import { getConfig } from '../config';
import logger from '../utils/logger';

/**
 * Service for interacting with the Google Drive API.
 * Handles listing, downloading, and moving video files.
 */
export class GoogleDriveService {
  private drive: drive_v3.Drive;
  private config = getConfig();

  constructor() {
    const auth = getOAuth2Client();
    this.drive = google.drive({ version: 'v3', auth });
  }

  /**
   * Lists video files in the specified Google Drive folder.
   * Filters to MP4 files only and orders by creation time (oldest first).
   */
  async listVideoFiles(options?: Partial<DriveListOptions>): Promise<DriveFile[]> {
    const folderId = options?.folderId ?? this.config.google.driveFolderId;

    return withRetry(
      async () => {
        logger.info('Listing video files from Google Drive', { folderId });

        const allFiles: DriveFile[] = [];
        let pageToken: string | undefined = undefined;

        do {
          const response = (await this.drive.files.list({
            q: `'${folderId}' in parents and mimeType = 'video/mp4' and trashed = false`,
            fields: 'nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime)',
            orderBy: 'createdTime asc',
            pageSize: options?.pageSize ?? 50,
            pageToken: pageToken,
          })) as unknown as { data: { files?: drive_v3.Schema$File[]; nextPageToken?: string } };

          const files: DriveFile[] = (response.data.files ?? []).map((f) => ({
            id: f.id ?? '',
            name: f.name ?? '',
            mimeType: f.mimeType ?? '',
            size: f.size ?? '0',
            createdTime: f.createdTime ?? '',
            modifiedTime: f.modifiedTime ?? '',
          }));

          // Filter to only .mp4 files by name as well (extra safety)
          const mp4Files = files.filter((f) => isMp4File(f.name));
          allFiles.push(...mp4Files);

          pageToken = response.data.nextPageToken ?? undefined;
        } while (pageToken);

        logger.info(`Found ${allFiles.length} MP4 file(s) in Drive folder`, { folderId });
        return allFiles;
      },
      {
        maxAttempts: this.config.upload.maxRetryAttempts,
        baseDelayMs: this.config.upload.retryBaseDelayMs,
      },
    );
  }

  /**
   * Finds a cover image (cover.jpg or cover.jpeg) in the specified folder.
   */
  async findCoverImage(folderId: string): Promise<DriveFile | null> {
    return withRetry(
      async () => {
        logger.info('Searching for cover image in Drive folder', { folderId });
        const response = (await this.drive.files.list({
          q: `'${folderId}' in parents and (name = 'cover.jpg' or name = 'cover.jpeg') and trashed = false`,
          fields: 'files(id, name, mimeType, size, createdTime, modifiedTime)',
          pageSize: 1,
        })) as unknown as { data: { files?: drive_v3.Schema$File[] } };

        const files = response.data.files ?? [];
        if (files.length === 0) return null;

        const f = files[0];
        return {
          id: f.id ?? '',
          name: f.name ?? '',
          mimeType: f.mimeType ?? '',
          size: f.size ?? '0',
          createdTime: f.createdTime ?? '',
          modifiedTime: f.modifiedTime ?? '',
        };
      },
      {
        maxAttempts: this.config.upload.maxRetryAttempts,
        baseDelayMs: this.config.upload.retryBaseDelayMs,
      },
    );
  }

  /**
   * Finds a caption file (caption.txt) in the specified folder.
   */
  async findCaptionFile(folderId: string): Promise<DriveFile | null> {
    return withRetry(
      async () => {
        logger.info('Searching for caption.txt in Drive folder', { folderId });
        const response = (await this.drive.files.list({
          q: `'${folderId}' in parents and name = 'caption.txt' and trashed = false`,
          fields: 'files(id, name, mimeType, size, createdTime, modifiedTime)',
          pageSize: 1,
        })) as unknown as { data: { files?: drive_v3.Schema$File[] } };

        const files = response.data.files ?? [];
        if (files.length === 0) return null;

        const f = files[0];
        return {
          id: f.id ?? '',
          name: f.name ?? '',
          mimeType: f.mimeType ?? '',
          size: f.size ?? '0',
          createdTime: f.createdTime ?? '',
          modifiedTime: f.modifiedTime ?? '',
        };
      },
      {
        maxAttempts: this.config.upload.maxRetryAttempts,
        baseDelayMs: this.config.upload.retryBaseDelayMs,
      },
    );
  }

  /**
   * Downloads a file from Google Drive to a local temporary path.
   * Uses streaming to support large files without loading into memory.
   */
  async downloadFile(fileId: string, fileName: string): Promise<DriveDownloadResult> {
    const safeName = sanitizeFileName(fileName);
    const localPath = getTempFilePath(safeName);

    logger.info('Downloading file from Google Drive', { fileId, fileName, localPath });

    return withRetry(
      async () => {
        const response = await this.drive.files.get(
          { fileId, alt: 'media' },
          { responseType: 'stream' },
        );

        await new Promise<void>((resolve, reject) => {
          const writeStream = fs.createWriteStream(localPath);

          (response.data as NodeJS.ReadableStream)
            .pipe(writeStream)
            .on('finish', resolve)
            .on('error', reject);

          (response.data as NodeJS.ReadableStream).on('error', (err: Error) => {
            writeStream.destroy();
            fs.unlink(localPath, () => undefined);
            reject(err);
          });
        });

        const stats = fs.statSync(localPath);
        logger.info('File downloaded successfully', {
          fileId,
          fileName,
          localPath,
          sizeBytes: stats.size,
        });

        // Get file metadata for MIME type
        const meta = await this.drive.files.get({
          fileId,
          fields: 'mimeType,size',
        });

        return {
          filePath: localPath,
          fileName: safeName,
          fileSize: stats.size,
          mimeType: meta.data.mimeType ?? 'video/mp4',
        };
      },
      {
        maxAttempts: this.config.upload.maxRetryAttempts,
        baseDelayMs: this.config.upload.retryBaseDelayMs,
        onRetry: (attempt, error) => {
          // Clean up partial download before retry
          if (fs.existsSync(localPath)) {
            fs.unlinkSync(localPath);
          }
          logger.warn('Retrying Drive download', {
            fileId,
            attempt,
            error: error instanceof Error ? error.message : String(error),
          });
        },
      },
    );
  }

  /**
   * Moves a file to the "Uploaded" folder by changing its parent.
   * This is the Google Drive equivalent of a file move operation.
   */
  async moveToUploaded(fileId: string, fileName: string, uploadedFolderId: string): Promise<void> {
    return withRetry(
      async () => {
        logger.info('Moving file to Uploaded folder', {
          fileId,
          fileName,
          targetFolderId: uploadedFolderId,
        });

        // Get current parents
        const file = await this.drive.files.get({
          fileId,
          fields: 'parents',
        });

        const previousParents = (file.data.parents ?? []).join(',');

        // Move to Uploaded folder
        await this.drive.files.update({
          fileId,
          addParents: uploadedFolderId,
          removeParents: previousParents,
          fields: 'id, parents',
        });

        logger.info('File moved to Uploaded folder successfully', {
          fileId,
          fileName,
          uploadedFolderId,
        });
      },
      {
        maxAttempts: this.config.upload.maxRetryAttempts,
        baseDelayMs: this.config.upload.retryBaseDelayMs,
      },
    );
  }

  /**
   * Gets metadata for a single file by its ID.
   */
  async getFileMetadata(fileId: string): Promise<DriveFile> {
    const response = await this.drive.files.get({
      fileId,
      fields: 'id, name, mimeType, size, createdTime, modifiedTime',
    });

    const f = response.data;
    return {
      id: f.id ?? '',
      name: f.name ?? '',
      mimeType: f.mimeType ?? '',
      size: f.size ?? '0',
      createdTime: f.createdTime ?? '',
      modifiedTime: f.modifiedTime ?? '',
    };
  }

  /**
   * Creates a publicly accessible (or signed) URL for uploading to Instagram.
   * Returns the webContentLink from Google Drive.
   */
  async getPublicDownloadUrl(fileId: string): Promise<string> {
    const response = await this.drive.files.get({
      fileId,
      fields: 'id, webContentLink, webViewLink',
    });

    if (!response.data.webContentLink) {
      throw new Error(`No download URL available for file: ${fileId}`);
    }

    return response.data.webContentLink;
  }
}

// Singleton instance
let driveService: GoogleDriveService | null = null;

export function getDriveService(): GoogleDriveService {
  if (!driveService) {
    driveService = new GoogleDriveService();
  }
  return driveService;
}
